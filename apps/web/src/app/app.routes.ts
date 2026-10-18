import type { Routes } from '@angular/router';
import { authGuard, permissionGuard } from './core/auth/guards';
import { Shell } from './core/layout/shell';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login').then((m) => m.LoginPage) },
  { path: 'reset-password', loadComponent: () => import('./features/login/reset-password').then((m) => m.ResetPasswordPage) },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./features/dashboard/home-redirect').then((m) => m.HomeRedirect) },
      { path: 'dashboard', canActivate: [permissionGuard('reports:read')], loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.DashboardPage) },
      { path: 'pos', canActivate: [permissionGuard('sales:checkout')], loadComponent: () => import('./features/pos/pos').then((m) => m.PosPage) },
      { path: 'receipts', canActivate: [permissionGuard('receipts:read')], loadComponent: () => import('./features/receipts/receipt-list').then((m) => m.ReceiptListPage) },
      { path: 'receipts/:id', canActivate: [permissionGuard('receipts:read')], loadComponent: () => import('./features/receipts/receipt-detail').then((m) => m.ReceiptDetailPage) },
      { path: 'returns', canActivate: [permissionGuard('returns:read')], loadComponent: () => import('./features/returns/return-list').then((m) => m.ReturnListPage) },
      { path: 'returns/new/:receiptId', canActivate: [permissionGuard('returns:create')], loadComponent: () => import('./features/returns/return-create').then((m) => m.ReturnCreatePage) },
      { path: 'shifts', canActivate: [permissionGuard('payments:read')], loadComponent: () => import('./features/pos/shift-list').then((m) => m.ShiftListPage) },
      { path: 'products', canActivate: [permissionGuard('products:read')], loadComponent: () => import('./features/products/product-list').then((m) => m.ProductListPage) },
      { path: 'products/new', canActivate: [permissionGuard('products:manage')], loadComponent: () => import('./features/products/product-form').then((m) => m.ProductFormPage) },
      { path: 'products/:id', canActivate: [permissionGuard('products:manage')], loadComponent: () => import('./features/products/product-form').then((m) => m.ProductFormPage) },
      { path: 'settings/tax', canActivate: [permissionGuard('tax:read')], loadComponent: () => import('./features/settings/tax-rules').then((m) => m.TaxRulesPage) },
      { path: 'settings/devices', canActivate: [permissionGuard('pos:devices:read')], loadComponent: () => import('./features/settings/devices').then((m) => m.DevicesPage) },
      { path: 'settings/company', canActivate: [permissionGuard('company:read')], loadComponent: () => import('./features/settings/company').then((m) => m.CompanyPage) },
      { path: 'eta', canActivate: [permissionGuard('eta:read')], loadComponent: () => import('./features/eta/eta-status').then((m) => m.EtaStatusPage) },
      { path: 'admin/users', canActivate: [permissionGuard('users:read')], loadComponent: () => import('./features/administration/users').then((m) => m.UsersPage) },
      { path: 'customers', canActivate: [permissionGuard('customers:read')], loadComponent: () => import('./features/customers/customers').then((m) => m.CustomersPage) },
      { path: 'settings/branches', canActivate: [permissionGuard('branches:read')], loadComponent: () => import('./features/settings/branches').then((m) => m.BranchesPage) },
      { path: 'imports', canActivate: [permissionGuard('imports:read')], loadComponent: () => import('./features/imports/import-list').then((m) => m.ImportListPage) },
      { path: 'imports/:id', canActivate: [permissionGuard('imports:read')], loadComponent: () => import('./features/imports/import-detail').then((m) => m.ImportDetailPage) },
      { path: 'reports', canActivate: [permissionGuard('reports:read')], loadComponent: () => import('./features/reports/reports').then((m) => m.ReportsPage) },
      { path: 'notifications', loadComponent: () => import('./features/notifications/notifications').then((m) => m.NotificationsPage) },
      { path: 'profile', loadComponent: () => import('./features/profile/profile').then((m) => m.ProfilePage) },
      { path: 'admin/audit', canActivate: [permissionGuard('audit:read')], loadComponent: () => import('./features/administration/audit').then((m) => m.AuditPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
