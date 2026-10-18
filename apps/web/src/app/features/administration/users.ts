import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { Branch, Role, User } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { LocalDatePipe } from '../../shared/money.pipe';

const ROLES: Role[] = ['COMPANY_ADMIN', 'FINANCE_MANAGER', 'CASHIER', 'ACCOUNTANT', 'AUDITOR', 'TECH_SUPPORT'];

@Component({
  selector: 'app-users',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row"><h1>{{ i18n.t('users.title') }}</h1><span class="spacer"></span>
      @if (auth.can('users:manage')) { <button mat-flat-button class="btn-primary" (click)="showForm.set(!showForm())">{{ i18n.t('users.new') }}</button> }
    </header>
    @if (showForm()) {
      <form class="panel grid" [formGroup]="form" (ngSubmit)="create()">
        <mat-form-field><mat-label>{{ i18n.t('users.name') }}</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('login.email') }}</mat-label><input matInput formControlName="email" type="email" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('users.password') }}</mat-label><input matInput formControlName="password" type="password" autocomplete="new-password" /><mat-hint>10–128</mat-hint></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('users.role') }}</mat-label>
          <mat-select formControlName="role">@for (r of roles; track r) { <mat-option [value]="r">{{ i18n.t('role.' + r) }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('users.branches') }}</mat-label>
          <mat-select formControlName="branchIds" multiple>@for (b of branches(); track b.id) { <mat-option [value]="b.id">{{ b.name }}</mat-option> }</mat-select>
        </mat-form-field>
        <div class="wide row"><span class="spacer"></span><button mat-flat-button class="btn-primary" [disabled]="form.invalid">{{ i18n.t('common.save') }}</button></div>
      </form>
    }
    <section class="panel">
      <table class="data">
        <thead><tr><th>{{ i18n.t('users.name') }}</th><th>{{ i18n.t('login.email') }}</th><th>{{ i18n.t('users.role') }}</th><th>{{ i18n.t('common.status') }}</th><th>{{ i18n.t('users.lastLogin') }}</th><th>{{ i18n.t('common.actions') }}</th></tr></thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr>
              <td>{{ u.name }}</td><td dir="ltr">{{ u.email }}</td><td>{{ i18n.t('role.' + u.role) }}</td>
              <td>{{ u.isActive ? i18n.t('common.active') : i18n.t('common.inactive') }}</td><td>{{ u.lastLoginAt | localDate }}</td>
              <td class="row">
                @if (auth.can('users:manage') && u.id !== auth.me()?.user?.id && u.role !== 'COMPANY_OWNER') {
                  <button mat-button (click)="toggle(u)">{{ u.isActive ? i18n.t('users.deactivate') : i18n.t('users.activate') }}</button>
                  <button mat-button (click)="revoke(u)">{{ i18n.t('users.revoke') }}</button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `header h1 { margin: 0; } .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 16px; margin-bottom: 16px; } .wide { grid-column: 1 / -1; }`,
})
export class UsersPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly users = signal<User[]>([]);
  readonly branches = signal<Branch[]>([]);
  readonly showForm = signal(false);
  readonly roles = ROLES;
  readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.minLength(2)]], email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128)]], role: ['CASHIER' as Role, Validators.required], branchIds: [[] as string[]],
  });

  constructor() {
    this.load();
    this.api.get<Branch[]>('/branches').subscribe({ next: (b) => this.branches.set(b), error: () => undefined });
  }
  load(): void {
    this.api.get<User[]>('/users').subscribe({ next: (u) => this.users.set(u), error: (e) => this.notify.error(e) });
  }
  create(): void {
    this.api.post('/users', { ...this.form.getRawValue(), locale: this.i18n.lang() }).subscribe({ next: () => { this.showForm.set(false); this.form.reset(); this.load(); }, error: (e) => this.notify.error(e) });
  }
  toggle(u: User): void {
    this.api.patch(`/users/${u.id}`, { isActive: !u.isActive }).subscribe({ next: () => this.load(), error: (e) => this.notify.error(e) });
  }
  revoke(u: User): void {
    this.api.post(`/users/${u.id}/revoke-sessions`).subscribe({ next: () => this.notify.success(this.i18n.t('company.saved')), error: (e) => this.notify.error(e) });
  }
}
