import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";
import restaurantRoutes from "./routes/restaurant";
import bookingRoutes from "./routes/booking";
import reviewRoutes from "./routes/review";
import favoriteRoutes from "./routes/favorite";
import mongoose from "mongoose";
import {
  collectDefaultMetrics,
  register,
  Counter,
  Histogram,
} from "prom-client";

dotenv.config();

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/dinebook";
console.log("Connecting to MongoDB:", MONGODB_URI);

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((error) => console.error("MongoDB connection error:", error));

// Initialize Prometheus metrics collection
collectDefaultMetrics({ prefix: "dinebook_" });

// Create custom metrics
const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});

const httpRequestDuration = new Histogram({
  name: "http_request_duration_ms",
  help: "Duration of HTTP requests in milliseconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.1, 5, 15, 50, 100, 500],
});

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Disable X-Powered-By header to prevent information leakage
app.disable("x-powered-by");

// Security middleware
app.use((req, res, next) => {
  // Content Security Policy (CSP)
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self';"
  );

  // Anti-clickjacking header
  res.setHeader("X-Frame-Options", "DENY");

  // Prevent MIME-sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  next();
});

// Prometheus metrics middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const route = req.route ? req.route.path : req.path;
    const statusCode = res.statusCode.toString();

    httpRequestsTotal.labels(req.method, route, statusCode).inc();
    httpRequestDuration.labels(req.method, route, statusCode).observe(duration);
  });

  next();
});

// CORS configuration
app.use(
  cors({
    origin: ["http://localhost:4200"], // Restrict to your frontend domain
    credentials: true,
  })
);
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/favorites", favoriteRoutes);

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to DineBook Backend!" });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Metrics endpoint for Prometheus
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Access the API at http://localhost:${port}`);
  console.log(`Metrics available at http://localhost:${port}/metrics`);
});
