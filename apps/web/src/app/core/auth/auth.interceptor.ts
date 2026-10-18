import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { API_BASE } from '../api/api.service';
import { AuthService } from './auth.service';

const NO_RETRY = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/password'];

/** Adds the bearer token to API calls; on 401 refreshes once and retries the request. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API_BASE)) return next(req);
  const auth = inject(AuthService);
  const withToken = (token: string | null) => (token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
  const skip = NO_RETRY.some((p) => req.url.startsWith(`${API_BASE}${p}`));

  return next(withToken(auth.token())).pipe(
    catchError((err: unknown) => {
      if (skip || !(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      return auth.refresh().pipe(
        switchMap((token) => {
          if (!token) {
            auth.endSession();
            return throwError(() => err);
          }
          return next(withToken(token));
        }),
      );
    }),
  );
};
