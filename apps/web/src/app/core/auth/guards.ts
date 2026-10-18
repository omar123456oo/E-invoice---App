import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/** UI-only guard. The API enforces every permission independently. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  if (await auth.restore()) return true;
  return inject(Router).createUrlTree(['/login']);
};

export const permissionGuard = (permission: string): CanActivateFn => async () => {
  const auth = inject(AuthService);
  if (!(await auth.restore())) return inject(Router).createUrlTree(['/login']);
  return auth.can(permission) ? true : inject(Router).createUrlTree(['/']);
};
