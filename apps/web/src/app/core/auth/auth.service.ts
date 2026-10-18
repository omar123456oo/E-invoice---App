import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError, finalize, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import { API_BASE } from '../api/api.service';
import type { Me } from '../api/models';

interface TokenResponse { accessToken: string; expiresIn: number }

/**
 * Session state. The access token lives only in memory (never in storage);
 * the refresh token is an httpOnly cookie the browser sends to /auth/refresh.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private accessToken: string | null = null;
  private refreshing$: Observable<string | null> | null = null;

  readonly me = signal<Me | null>(null);
  readonly isAuthenticated = computed(() => this.me() !== null);
  readonly permissions = computed(() => new Set(this.me()?.permissions ?? []));

  token(): string | null {
    return this.accessToken;
  }

  can(permission: string): boolean {
    return this.permissions().has(permission);
  }

  login(email: string, password: string, totp?: string): Observable<Me> {
    return this.http.post<TokenResponse>(`${API_BASE}/auth/login`, { email, password, ...(totp ? { totp } : {}) }, { withCredentials: true }).pipe(
      tap((r) => (this.accessToken = r.accessToken)),
      switchMap(() => this.loadMe()),
    );
  }

  loadMe(): Observable<Me> {
    return this.http.get<Me>(`${API_BASE}/auth/me`).pipe(tap((me) => this.me.set(me)));
  }

  /** Single-flight refresh: concurrent 401s share one refresh request. */
  refresh(): Observable<string | null> {
    this.refreshing$ ??= this.http
      .post<TokenResponse>(`${API_BASE}/auth/refresh`, {}, { withCredentials: true, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .pipe(
        map((r) => (this.accessToken = r.accessToken)),
        catchError(() => {
          this.clear();
          return of(null);
        }),
        finalize(() => (this.refreshing$ = null)),
        shareReplay(1),
      );
    return this.refreshing$;
  }

  /** Restores a session from the refresh cookie at startup. */
  async restore(): Promise<boolean> {
    if (this.me()) return true;
    const token = await firstValueFrom(this.refresh());
    if (!token) return false;
    try {
      await firstValueFrom(this.loadMe());
      return true;
    } catch {
      this.clear();
      return false;
    }
  }

  logout(): void {
    this.http.post(`${API_BASE}/auth/logout`, {}, { withCredentials: true }).subscribe({ complete: () => this.endSession(), error: () => this.endSession() });
  }

  endSession(): void {
    this.clear();
    void this.router.navigate(['/login']);
  }

  private clear(): void {
    this.accessToken = null;
    this.me.set(null);
  }
}
