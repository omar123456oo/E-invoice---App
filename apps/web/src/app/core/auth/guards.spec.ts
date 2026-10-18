import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { authGuard } from './guards';

@Component({ template: '' })
class Blank {}

describe('authGuard', () => {
  // Regression: inject(Router) after an await threw NG0203 and left a blank page for signed-out visitors.
  it('redirects a signed-out visitor to /login', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'login', component: Blank }, { path: '', component: Blank, canActivate: [authGuard] }]), provideHttpClient(), provideHttpClientTesting()],
    });
    const router = TestBed.inject(Router);
    const ctl = TestBed.inject(HttpTestingController);
    const nav = router.navigateByUrl('/');
    let flushed = false;
    for (let i = 0; i < 50 && !flushed; i++) {
      const [req] = ctl.match('/api/v1/auth/refresh');
      if (req) {
        req.flush({}, { status: 401, statusText: 'Unauthorized' });
        flushed = true;
      } else await new Promise((r) => setTimeout(r, 10));
    }
    expect(flushed).toBe(true);
    await nav;
    expect(router.url).toBe('/login');
  });
});
