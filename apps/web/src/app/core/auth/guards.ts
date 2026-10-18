import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * UI-only guards. The API enforces every permission independently.
 * All inject() calls happen before the first await: after an await the code is
 * no longer in an injection context and inject() throws (NG0203).
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (await auth.restore()) return true;
  return router.createUrlTree(['/login']);
};

export const permissionGuard = (permission: string): CanActivateFn => async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!(await auth.restore())) return router.createUrlTree(['/login']);
  return auth.can(permission) ? true : router.createUrlTree(['/']);
};
