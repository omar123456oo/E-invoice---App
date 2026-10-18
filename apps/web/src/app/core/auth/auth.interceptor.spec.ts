import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

@Component({ template: '' })
class Blank {}

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'login', component: Blank }]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctl = TestBed.inject(HttpTestingController);
  });

  it('refreshes once on 401 and retries with the new token', () => {
    let body: unknown;
    http.get('/api/v1/products').subscribe((b) => (body = b));
    ctl.expectOne('/api/v1/products').flush({ error: {} }, { status: 401, statusText: 'Unauthorized' });
    const refresh = ctl.expectOne('/api/v1/auth/refresh');
    expect(refresh.request.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(refresh.request.withCredentials).toBe(true);
    refresh.flush({ accessToken: 'new-token', expiresIn: 900 });
    const retry = ctl.expectOne('/api/v1/products');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-token');
    retry.flush({ ok: true });
    expect(body).toEqual({ ok: true });
    ctl.verify();
  });

  it('ends the session when refresh fails', () => {
    const auth = TestBed.inject(AuthService);
    let failed = false;
    http.get('/api/v1/receipts').subscribe({ error: () => (failed = true) });
    ctl.expectOne('/api/v1/receipts').flush({}, { status: 401, statusText: 'Unauthorized' });
    ctl.expectOne('/api/v1/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(failed).toBe(true);
    expect(auth.token()).toBeNull();
    ctl.verify();
  });

  it('does not attach tokens to non-API requests', () => {
    http.get('/assets/x.json').subscribe();
    expect(ctl.expectOne('/assets/x.json').request.headers.has('Authorization')).toBe(false);
  });
});
