import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api/api.service';
import type { SessionInfo } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { LocalDatePipe } from '../../shared/money.pipe';

@Component({
  selector: 'app-profile',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ i18n.t('profile.title') }}</h1>
    <p class="muted">{{ auth.me()?.user?.name }} — <span dir="ltr">{{ auth.me()?.user?.email }}</span> — {{ i18n.t('role.' + auth.me()?.user?.role) }}</p>
    <div class="grid">
      <section class="panel stack">
        <h2>{{ i18n.t('profile.mfa') }}</h2>
        @if (auth.me()?.user?.mfa?.enabled) {
          <p>{{ i18n.t('profile.mfaOn') }}</p>
          <mat-form-field><mat-label>{{ i18n.t('profile.current') }}</mat-label><input matInput type="password" [(ngModel)]="mfaPassword" autocomplete="current-password" /></mat-form-field>
          <mat-form-field><mat-label>{{ i18n.t('login.totp') }}</mat-label><input matInput [(ngModel)]="mfaCode" inputmode="numeric" maxlength="6" dir="ltr" autocomplete="one-time-code" /></mat-form-field>
          <button mat-stroked-button (click)="disableMfa()">{{ i18n.t('profile.mfaDisable') }}</button>
        } @else if (secret()) {
          <p>{{ i18n.t('profile.mfaKey') }}</p>
          <code class="key" dir="ltr">{{ secret() }}</code>
          <mat-form-field><mat-label>{{ i18n.t('login.totp') }}</mat-label><input matInput [(ngModel)]="mfaCode" inputmode="numeric" maxlength="6" dir="ltr" autocomplete="one-time-code" /></mat-form-field>
          <button mat-flat-button class="btn-primary" (click)="confirmMfa()">{{ i18n.t('profile.mfaConfirm') }}</button>
        } @else {
          <p>{{ i18n.t('profile.mfaOff') }}</p>
          <button mat-flat-button class="btn-primary" (click)="startMfa()">{{ i18n.t('profile.mfaStart') }}</button>
        }
      </section>
      <section class="panel stack">
        <h2>{{ i18n.t('profile.password') }}</h2>
        <form class="stack" (ngSubmit)="changePassword()">
          <mat-form-field><mat-label>{{ i18n.t('profile.current') }}</mat-label><input matInput name="cur" type="password" [(ngModel)]="current" autocomplete="current-password" /></mat-form-field>
          <mat-form-field><mat-label>{{ i18n.t('profile.new') }}</mat-label><input matInput name="new" type="password" [(ngModel)]="next" autocomplete="new-password" minlength="10" /><mat-hint>10–128</mat-hint></mat-form-field>
          <button mat-flat-button class="btn-primary" type="submit" [disabled]="next.length < 10 || !current">{{ i18n.t('common.save') }}</button>
        </form>
      </section>
    </div>
    <section class="panel">
      <h2>{{ i18n.t('profile.sessions') }}</h2>
      <table class="data"><tbody>
        @for (s of sessions(); track s.id) {
          <tr>
            <td>{{ s.current ? i18n.t('profile.thisDevice') : '' }}<div class="muted small" dir="ltr">{{ s.userAgent }}</div></td>
            <td class="num" dir="ltr">{{ s.ip }}</td><td>{{ s.lastUsedAt | localDate }}</td>
            <td>@if (!s.current) { <button mat-button (click)="revoke(s)">{{ i18n.t('profile.revoke') }}</button> }</td>
          </tr>
        }
      </tbody></table>
    </section>
  `,
  styles: `.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 20px; } .key { font-size: 1.1rem; letter-spacing: 0.08em; background: var(--paper); padding: 8px 12px; border-radius: var(--radius-s); word-break: break-all; } .small { font-size: 0.8rem; }`,
})
export class ProfilePage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly sessions = signal<SessionInfo[]>([]);
  readonly secret = signal<string | null>(null);
  mfaCode = '';
  mfaPassword = '';
  current = '';
  next = '';

  constructor() {
    this.loadSessions();
  }
  loadSessions(): void {
    this.api.get<SessionInfo[]>('/auth/sessions').subscribe({ next: (s) => this.sessions.set(s), error: (e) => this.notify.error(e) });
  }
  startMfa(): void {
    this.api.post<{ secret: string }>('/auth/mfa/setup').subscribe({ next: (r) => this.secret.set(r.secret), error: (e) => this.notify.error(e) });
  }
  confirmMfa(): void {
    this.api.post('/auth/mfa/confirm', { code: this.mfaCode.trim() }).subscribe({
      next: () => { this.secret.set(null); this.mfaCode = ''; this.auth.loadMe().subscribe(); this.notify.success(this.i18n.t('profile.mfaOn')); },
      error: (e) => this.notify.error(e),
    });
  }
  disableMfa(): void {
    this.api.post('/auth/mfa/disable', { password: this.mfaPassword, code: this.mfaCode.trim() }).subscribe({
      next: () => { this.mfaCode = ''; this.mfaPassword = ''; this.auth.loadMe().subscribe(); this.notify.success(this.i18n.t('profile.mfaOff')); },
      error: (e) => this.notify.error(e),
    });
  }
  changePassword(): void {
    this.api.post('/auth/password/change', { currentPassword: this.current, newPassword: this.next }).subscribe({
      next: () => { this.current = ''; this.next = ''; this.notify.success(this.i18n.t('profile.changed')); this.loadSessions(); },
      error: (e) => this.notify.error(e),
    });
  }
  revoke(s: SessionInfo): void {
    this.api.delete(`/auth/sessions/${s.id}`).subscribe({ next: () => this.loadSessions(), error: (e) => this.notify.error(e) });
  }
}
