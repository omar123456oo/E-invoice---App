import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api/api.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="card stack">
        <h1>{{ i18n.t('reset.title') }}</h1>
        @if (message()) {
          <p role="status">{{ message() }}</p>
          <a routerLink="/login">{{ i18n.t('login.title') }}</a>
        } @else if (token()) {
          <form class="stack" [formGroup]="resetForm" (ngSubmit)="reset()">
            <mat-form-field>
              <mat-label>{{ i18n.t('reset.newPassword') }}</mat-label>
              <input matInput type="password" formControlName="newPassword" autocomplete="new-password" />
              <mat-hint>10–128</mat-hint>
            </mat-form-field>
            <button mat-flat-button class="btn-primary" [disabled]="resetForm.invalid">{{ i18n.t('reset.submit') }}</button>
          </form>
        } @else {
          <form class="stack" [formGroup]="requestForm" (ngSubmit)="request()">
            <mat-form-field>
              <mat-label>{{ i18n.t('login.email') }}</mat-label>
              <input matInput type="email" formControlName="email" dir="ltr" />
            </mat-form-field>
            <button mat-flat-button class="btn-primary" [disabled]="requestForm.invalid">{{ i18n.t('reset.request') }}</button>
          </form>
        }
      </div>
    </div>
  `,
  styles: `.wrap { min-height: 100vh; display: grid; place-items: center; padding: 16px; } .card { width: min(420px, 100%); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-m); padding: 28px; }`,
})
export class ResetPasswordPage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(NonNullableFormBuilder);
  readonly token = input<string>();
  readonly message = signal<string | null>(null);
  readonly requestForm = this.fb.group({ email: ['', [Validators.required, Validators.email]] });
  readonly resetForm = this.fb.group({ newPassword: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128)]] });

  request(): void {
    this.api.post('/auth/password/forgot', this.requestForm.getRawValue()).subscribe({
      next: () => this.message.set(this.i18n.t('reset.sent')),
      error: (e) => this.notify.error(e),
    });
  }

  reset(): void {
    this.api.post('/auth/password/reset', { token: this.token(), ...this.resetForm.getRawValue() }).subscribe({
      next: () => this.message.set(this.i18n.t('reset.done')),
      error: (e) => this.notify.error(e),
    });
  }
}
