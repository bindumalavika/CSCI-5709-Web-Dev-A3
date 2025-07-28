import { Routes } from '@angular/router';
import { LandingComponent } from './pages/landing/landing';
import { OwnerLandingComponent } from './pages/owner-landing/owner-landing';
import { SignInComponent } from './pages/sign-in/sign-in';
import { SignUpComponent } from './pages/sign-up/sign-up';
import { VerifyComponent } from './pages/verify/verify';
import { DashboardComponent } from './pages/dashboard/dashboard';
import { OwnerDashboardComponent } from './pages/owner-dashboard/owner-dashboard';
import { OwnerBookingsComponent } from './pages/owner-bookings/owner-bookings';
import { RestaurantManagementComponent } from './pages/restaurant-management/restaurant-management';
import { MenuManagementComponent } from './pages/menu-management/menu-management';
import { RestaurantsComponent } from './pages/restaurants/restaurants';
import { RestaurantDetailComponent } from './pages/restaurant-detail/restaurant-detail';
import { AboutComponent } from './pages/about/about';
import { ContactComponent } from './pages/contact/contact';
import { BookTableComponent } from './pages/book-table/book-table';
import { MyBookingsComponent } from './pages/my-bookings/my-bookings';
import { MyReviewsComponent } from './pages/my-reviews/my-reviews';
import { BookingConfirmationComponent } from './components/booking-confirmation/booking-confirmation';
import { PublicGuard } from './guards/public.guard';
import { OwnerGuard } from './guards/owner.guard';
import { CustomerGuard } from './guards/customer.guard';
import { FavoritesPageComponent } from './pages/favorites/favorites-page.component';

export const routes: Routes = [
  { path: '', redirectTo: '/landing', pathMatch: 'full' },
  { path: 'landing', component: LandingComponent },
  { path: 'owner-home', component: OwnerLandingComponent, canActivate: [OwnerGuard] },
  { path: 'sign-in', component: SignInComponent, canActivate: [PublicGuard] },
  { path: 'sign-up', component: SignUpComponent, canActivate: [PublicGuard] },
  { path: 'verify', component: VerifyComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [CustomerGuard] },
  { path: 'owner/dashboard', component: OwnerDashboardComponent, canActivate: [OwnerGuard] },
  { path: 'owner/restaurant', component: RestaurantManagementComponent, canActivate: [OwnerGuard] },
  { path: 'owner/menu', component: MenuManagementComponent, canActivate: [OwnerGuard] },
  { path: 'owner/bookings', component: OwnerBookingsComponent, canActivate: [OwnerGuard] },
  { path: 'restaurants', component: RestaurantsComponent },
  { path: 'restaurants/:id',loadComponent: () => import('./pages/restaurant-detail/restaurant-detail').then(m => m.RestaurantDetailComponent) },
  { path: 'book-table', loadComponent: () => import('./pages/book-table/book-table').then(m => m.BookTableComponent), canActivate: [CustomerGuard] },
  { path: 'book-table/:restaurantId', loadComponent: () => import('./pages/book-table/book-table').then(m => m.BookTableComponent), canActivate: [CustomerGuard] },
  { path: 'my-bookings',  loadComponent: () => import('./pages/my-bookings/my-bookings').then(m => m.MyBookingsComponent), canActivate: [CustomerGuard] },
  { path: 'my-reviews', loadComponent: () => import('./pages/my-reviews/my-reviews').then(m => m.MyReviewsComponent), canActivate: [CustomerGuard] },
  { path: 'booking-confirmation/:bookingId', component: BookingConfirmationComponent, canActivate: [CustomerGuard] },
  { path: 'about', component: AboutComponent },
  { path: 'contact', component: ContactComponent },
  { path: 'favorites',  loadComponent: () => import('./pages/favorites/favorites-page.component').then(m => m.FavoritesPageComponent) },
  { path: '**', redirectTo: '/landing' }
];