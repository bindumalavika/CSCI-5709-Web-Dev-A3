import { Request, Response } from "express";
import mongoose from "mongoose";
import { Booking, Restaurant } from "../models/";
import { sendBookingConfirmationEmail } from "../utils/email";
import {
    BookingValidators,
    ResponseHelper,
    BookingDatabase,
    TimeHelper,
    BookingInputValidator
} from "../utils/booking-helpers";
import type { AuthenticatedRequest, CreateBookingBody } from "../types";
import NodeCache from "node-cache";

// In-memory cache instance with shorter TTL for bookings (2 minutes)
// Bookings can change more frequently as users make and cancel reservations
const cache = new NodeCache({ stdTTL: 120 }); // 2 minutes TTL

export const getAvailability = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { restaurantId, date } = req.query as { restaurantId: string; date: string };

        // Create a cache key for this specific restaurant and date
        const cacheKey = `availability-${restaurantId}-${date}`;
        
        // Check cache first - Optimization: In-memory caching for booking availability
        const cachedAvailability = cache.get(cacheKey);
        if (cachedAvailability) {
            res.json(JSON.parse(cachedAvailability as string));
            return;
        }

        const validationError = BookingInputValidator.validateAvailabilityInput(req.query);
        if (validationError) {
            return ResponseHelper.sendValidationError(res, validationError);
        }

        const restaurant = await BookingDatabase.findRestaurantById(restaurantId);

        const dayOfWeek = TimeHelper.getDayOfWeek(date);
        const openingHours = TimeHelper.getOpeningHours(restaurant, dayOfWeek);

        if (TimeHelper.isRestaurantClosed(openingHours)) {
            res.json({
                restaurantId,
                date,
                availableSlots: [],
                message: `Restaurant is closed on ${dayOfWeek}`
            });
            return;
        }

        const timeSlots = TimeHelper.generateTimeSlots(openingHours.open, openingHours.close);
        const existingBookings = await Booking.find({
            restaurantId,
            date,
            status: { $in: ['confirmed', 'pending'] }
        });

        const bookingCounts: { [key: string]: number } = {};
        existingBookings.forEach(booking => {
            bookingCounts[booking.time] = (bookingCounts[booking.time] || 0) + booking.guests;
        });

        const availableSlots = timeSlots.map((time: string) => {
            const bookedGuests = bookingCounts[time] || 0;
            const availableCapacity = restaurant.capacity - bookedGuests;

            return {
                time,
                available: availableCapacity > 0,
                availableCapacity,
                totalCapacity: restaurant.capacity
            };
        });

        const response = {
            restaurantId,
            restaurantName: restaurant.name,
            date,
            dayOfWeek,
            openingHours: {
                open: openingHours.open,
                close: openingHours.close
            },
            availableSlots,
            totalSlots: timeSlots.length
        };
        
        // Store in cache with a 5-minute TTL (shorter for time slots as they change more frequently)
        cache.set(cacheKey, JSON.stringify(response), 300); // 5 minutes TTL
        
        res.json(response);

    } catch (error) {
        console.error("Availability fetch error:", error);

        if (error instanceof Error) {
            if (error.name === 'CastError') {
                return ResponseHelper.sendValidationError(res, "Invalid restaurant ID");
            }
            if (error.name === 'NotFoundError') {
                return ResponseHelper.sendNotFoundError(res, error.message);
            }
        }

        ResponseHelper.sendError(res, 500, "Failed to fetch availability");
    }
};

export const createBooking = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { restaurantId, date, time, guests, specialRequests } = req.body;
        const customerId = req.user.id;

        const validationError = BookingInputValidator.validateCreateBookingInput(req.body);
        if (validationError) {
            return ResponseHelper.sendValidationError(res, validationError);
        }

        const [restaurant, user] = await Promise.all([
            BookingDatabase.findRestaurantById(restaurantId),
            BookingDatabase.findUserById(customerId)
        ]);

        const dayOfWeek = TimeHelper.getDayOfWeek(date);
        const openingHours = TimeHelper.getOpeningHours(restaurant, dayOfWeek);

        if (TimeHelper.isRestaurantClosed(openingHours)) {
            return ResponseHelper.sendValidationError(res, `Restaurant is closed on ${dayOfWeek}`);
        }

        if (!BookingValidators.isTimeWithinHours(time, openingHours.open, openingHours.close)) {
            return ResponseHelper.sendValidationError(res,
                `Restaurant is closed at ${time}. Hours: ${openingHours.open} - ${openingHours.close}`);
        }

        const existingBookingsCount = await Booking.aggregate([
            {
                $match: {
                    restaurantId: new mongoose.Types.ObjectId(restaurantId),
                    date,
                    time,
                    status: { $in: ['confirmed', 'pending'] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalGuests: { $sum: '$guests' }
                }
            }
        ]);

        const bookedGuests = existingBookingsCount[0]?.totalGuests || 0;
        const availableCapacity = restaurant.capacity - bookedGuests;

        if (guests > availableCapacity) {
            if (availableCapacity <= 0) {
                return ResponseHelper.sendConflictError(res,
                    `No tables available at ${time} on ${date}`);
            } else {
                return ResponseHelper.sendConflictError(res,
                    `Only ${availableCapacity} seats available at ${time} on ${date}`);
            }
        }

        let booking;
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            booking = new Booking({
                customerId,
                restaurantId,
                date,
                time,
                guests,
                specialRequests: specialRequests?.trim() || undefined,
                status: 'confirmed'
            });

            await booking.save({ session });
            await session.commitTransaction();
            await sendConfirmationEmail(user.email, booking, restaurant.name, specialRequests);

        } catch (transactionError) {
            console.error('Error during booking creation:', transactionError);
            await session.abortTransaction();
            throw transactionError;
        } finally {
            session.endSession();
        }

        res.status(201).json({
            message: "Booking created successfully",
            booking: {
                id: booking._id,
                customerId: booking.customerId,
                restaurantId: booking.restaurantId,
                restaurantName: restaurant.name,
                date: booking.date,
                time: booking.time,
                guests: booking.guests,
                specialRequests: booking.specialRequests,
                status: booking.status,
                createdAt: booking.createdAt
            }
        });
        
        // Invalidate caches after successful booking creation
        cache.del(`user-bookings-${customerId}-all--`);
        cache.del(`availability-${restaurantId}-${date}`);

    } catch (error) {
        console.error("Booking creation error:", error);
        handleBookingError(res, error);
    }
};

export const getBookingById = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const customerId = req.user.id;

        const booking = await BookingDatabase.findUserBookingById(id, customerId);

        res.json({
            id: booking._id,
            customerId: booking.customerId,
            restaurantId: booking.restaurantId._id,
            restaurantName: (booking.restaurantId as any).name,
            date: booking.date,
            time: booking.time,
            guests: booking.guests,
            specialRequests: booking.specialRequests,
            status: booking.status,
            createdAt: booking.createdAt,
            updatedAt: booking.updatedAt
        });

    } catch (error) {
        console.error("Booking fetch error:", error);
        handleBookingError(res, error);
    }
};

export const cancelBooking = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const customerId = req.user.id;

        const booking = await BookingDatabase.findUserBookingById(id, customerId);

        if (booking.status === 'cancelled') {
            return ResponseHelper.sendValidationError(res, "Booking is already cancelled");
        }

        const bookingDateTime = new Date(`${booking.date}T${booking.time}:00`);
        const now = new Date();

        if (bookingDateTime < now) {
            return ResponseHelper.sendValidationError(res, "Cannot cancel past bookings");
        }

        booking.status = 'cancelled';
        await booking.save();

        // Invalidate user bookings cache after status change
        cache.del(`user-bookings-${customerId}-all--`);
        
        // Also invalidate availability cache since a slot is now free
        cache.del(`availability-${booking.restaurantId}-${booking.date}`);

        res.json({
            message: "Booking cancelled successfully",
            booking: {
                id: booking._id,
                customerId: booking.customerId,
                restaurantId: booking.restaurantId,
                restaurantName: (booking.restaurantId as any).name,
                date: booking.date,
                time: booking.time,
                guests: booking.guests,
                specialRequests: booking.specialRequests,
                status: booking.status,
                updatedAt: booking.updatedAt
            }
        });

    } catch (error) {
        console.error("Cancel booking error:", error);
        handleBookingError(res, error);
    }
};

async function sendConfirmationEmail(
    userEmail: string,
    booking: any,
    restaurantName: string,
    specialRequests?: string
): Promise<void> {
    try {
        await sendBookingConfirmationEmail(userEmail, {
            bookingId: booking._id.toString(),
            restaurantName,
            date: booking.date,
            time: booking.time,
            guests: booking.guests,
            specialRequests
        });

    } catch (emailError) {
        console.error("Failed to send confirmation email:", emailError);
        console.error("Email error details:", {
            userEmail,
            errorMessage: emailError instanceof Error ? emailError.message : 'Unknown error'
        });
    }
}

export const getUserBookings = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        const customerId = req.user.id;
        const { status, dateFrom, dateTo } = req.query as {
            status?: string;
            dateFrom?: string;
            dateTo?: string;
        };

        // Create a unique cache key based on query parameters
        const cacheKey = `user-bookings-${customerId}-${status || 'all'}-${dateFrom || ''}-${dateTo || ''}`;
        
        // Check cache first - Optimization 1: In-memory caching
        const cachedBookings = cache.get(cacheKey);
        if (cachedBookings) {
            res.json(JSON.parse(cachedBookings as string));
            return;
        }

        const filter: any = { customerId };
        if (status && status !== 'all') filter.status = status;
        if (dateFrom || dateTo) {
            filter.date = {};
            if (dateFrom) filter.date.$gte = dateFrom;
            if (dateTo) filter.date.$lte = dateTo;
        }

        const bookings = await Booking.find(filter)
            .populate('restaurantId', 'name')
            .sort({ createdAt: -1 })
            .lean(); // Convert Mongoose documents to plain JS objects

        const formattedBookings = bookings.map(booking => ({
            id: booking._id,
            customerId: booking.customerId,
            restaurantId: booking.restaurantId._id,
            restaurantName: (booking.restaurantId as any).name,
            date: booking.date,
            time: booking.time,
            guests: booking.guests,
            specialRequests: booking.specialRequests,
            status: booking.status,
            createdAt: booking.createdAt,
            updatedAt: booking.updatedAt
        }));
        
        // Store in cache
        cache.set(cacheKey, JSON.stringify(formattedBookings));

        res.json(formattedBookings);
    } catch (error) {
        console.error("Bookings fetch error:", error);
        handleBookingError(res, error);
    }
};

export const getBookingStats = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<void> => {
    try {
        if (req.user.role !== 'owner') {
            res.status(403).json({ error: "Only restaurant owners can access booking stats" });
            return;
        }

        const { restaurantId } = req.params;
        
        // Verify restaurant ownership
        const restaurant = await Restaurant.findOne({ _id: restaurantId, ownerId: req.user.id });
        if (!restaurant) {
            res.status(404).json({ error: "Restaurant not found or you don't have access to it" });
            return;
        }

        // Get bookings stats
        const totalBookings = await Booking.countDocuments({ 
            restaurantId, 
            status: { $in: ['confirmed', 'completed'] } 
        });
        
        const upcomingBookings = await Booking.countDocuments({ 
            restaurantId, 
            status: 'confirmed',
            date: { $gte: new Date().toISOString().split('T')[0] }
        });
        
        const cancelledBookings = await Booking.countDocuments({ 
            restaurantId, 
            status: 'cancelled' 
        });

        // Get total guests
        const totalGuestsResult = await Booking.aggregate([
            { 
                $match: { 
                    restaurantId: new mongoose.Types.ObjectId(restaurantId),
                    status: { $in: ['confirmed', 'completed'] } 
                } 
            },
            { 
                $group: { 
                    _id: null, 
                    totalGuests: { $sum: "$guests" } 
                } 
            }
        ]);
        
        const totalGuests = totalGuestsResult.length > 0 ? totalGuestsResult[0].totalGuests : 0;

        // Get monthly bookings (last 6 months)
        const today = new Date();
        const sixMonthsAgo = new Date(today);
        sixMonthsAgo.setMonth(today.getMonth() - 6);
        
        const monthlyStats = await Booking.aggregate([
            { 
                $match: { 
                    restaurantId: new mongoose.Types.ObjectId(restaurantId),
                    status: { $in: ['confirmed', 'completed'] },
                    createdAt: { $gte: sixMonthsAgo }
                } 
            },
            { 
                $group: { 
                    _id: { 
                        year: { $year: "$createdAt" }, 
                        month: { $month: "$createdAt" } 
                    },
                    count: { $sum: 1 },
                    guests: { $sum: "$guests" }
                } 
            },
            { 
                $sort: { 
                    "_id.year": 1, 
                    "_id.month": 1 
                } 
            }
        ]);

        res.json({
            totalBookings,
            upcomingBookings,
            cancelledBookings,
            totalGuests,
            monthlyStats: monthlyStats.map(stat => ({
                year: stat._id.year,
                month: stat._id.month,
                bookings: stat.count,
                guests: stat.guests
            }))
        });

    } catch (error) {
        console.error("Error fetching booking stats:", error);
        handleBookingError(res, error);
    }
};

function handleBookingError(res: Response, error: any): void {
    if (error instanceof mongoose.Error.CastError) {
        return ResponseHelper.sendValidationError(res, "Invalid ID format");
    }
    if (error instanceof mongoose.Error.ValidationError) {
        return ResponseHelper.sendValidationError(res, "Validation error: " + error.message);
    }
    if (error instanceof Error && error.name === 'NotFoundError') {
        return ResponseHelper.sendNotFoundError(res, error.message);
    }
    
    ResponseHelper.sendError(res, 500, "An unexpected error occurred");
}
