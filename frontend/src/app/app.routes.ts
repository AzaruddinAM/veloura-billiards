import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/auth';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage), title: 'Sign in · Veloura Billiards' },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', loadComponent: () => import('./pages/floor/floor').then((m) => m.FloorPage), title: 'Floor · Veloura Billiards' },
      { path: 'sessions', loadComponent: () => import('./pages/sessions/sessions').then((m) => m.SessionsPage), title: 'Sessions · Veloura Billiards' },
      { path: 'accounts', loadComponent: () => import('./pages/accounts/accounts').then((m) => m.AccountsPage), title: 'Accounts · Veloura Billiards' },
      { path: 'month-end', canActivate: [adminGuard], loadComponent: () => import('./pages/month-end/month-end').then((m) => m.MonthEndPage), title: 'Month End · Veloura Billiards' },
      { path: 'admin', canActivate: [adminGuard], loadComponent: () => import('./pages/admin/admin').then((m) => m.AdminPage), title: 'Admin · Veloura Billiards' },
    ],
  },
  { path: '**', redirectTo: '' },
];
