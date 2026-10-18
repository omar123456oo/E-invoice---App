import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import type { ApiErrorBody } from '../../core/api/models';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <form class="card stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="row head">
          <h1>{{ i18n.t('app.name') }}</h1>
          <span class="spacer"></span>
          <button mat-button type="button" (click)="i18n.toggle()">{{ i18n.t('common.language') }}</button>
        </div>
        <h2>{{ i18n.t('login.title') }}</h2>
        <mat-form-field>
          <mat-label>{{ i18n.t('login.email') }}</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="username" dir="ltr" required />
          @if (form.controls.email.touched && form.controls.email.invalid) { <mat-error>{{ i18n.t('error.invalid') }}</mat-error> }
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ i18n.t('login.password') }}</mat-label>
          <input matInput type="password" formControlName="password" autocomplete="current-password" required />
          @if (form.controls.password.touched && form.controls.password.invalid) { <mat-error>{{ i18n.t('error.required') }}</mat-error> }
        </mat-form-field>
        @if (mfa()) {
          <p class="muted">{{ i18n.t('login.mfaPrompt') }}</p>
          <mat-form-field>
            <mat-label>{{ i18n.t('login.totp') }}</mat-label>
            <input matInput formControlName="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" />
          </mat-form-field>
        }
        @if (error()) { <p class="error-text" role="alert">{{ error() }}</p> }
        <button mat-flat-button class="btn-primary" type="submit" [disabled]="busy()">{{ i18n.t('login.submit') }}</button>
        <a routerLink="/reset-password">{{ i18n.t('login.forgot') }}</a>
      </form>
    </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 16px; background: linear-gradient(180deg, var(--ink) 0 38%, var(--paper) 38%); }
    .card { width: min(420px, 100%); background: var(--panel); border-radius: var(--radius-m); padding: 28px; border: 1px solid var(--line); }
    .head h1 { margin: 0; }
  `,
})
export class LoginPage {
  readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);
  readonly busy = signal(false);
  readonly mfa = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    totp: [''],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, password, totp } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(email, password, totp || undefined).subscribe({
      next: (me) => {
        if (me.user.locale && me.user.locale !== this.i18n.lang()) this.i18n.lang.set(me.user.locale);
        void this.router.navigate(['/']);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const code = err instanceof HttpErrorResponse ? (err.error as ApiErrorBody | null)?.error?.code : undefined;
        if (code === 'MFA_REQUIRED') {
          this.mfa.set(true);
          return;
        }
        this.error.set(this.notify.describe(err));
      },
    });
  }
}
