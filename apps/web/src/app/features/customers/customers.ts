import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { Customer, Page } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EmptyState } from '../../shared/empty-state';
import { LocalDatePipe } from '../../shared/money.pipe';
import { Paginator } from '../../shared/paginator';

@Component({
  selector: 'app-customers',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, LocalDatePipe, Paginator, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row"><h1>{{ i18n.t('customers.title') }}</h1><span class="spacer"></span>
      @if (auth.can('customers:manage')) { <button mat-flat-button class="btn-primary" (click)="showForm.set(!showForm())">{{ i18n.t('customers.new') }}</button> }
    </header>
    @if (showForm()) {
      <form class="panel grid" (ngSubmit)="create()">
        <p class="wide muted">{{ i18n.t('customers.privacy') }}</p>
        <mat-form-field><mat-label>{{ i18n.t('customers.type') }}</mat-label>
          <mat-select name="t" [(ngModel)]="form.buyerType">@for (t of ['P', 'B', 'F']; track t) { <mat-option [value]="t">{{ i18n.t('customers.type.' + t) }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('users.name') }}</mat-label><input matInput name="n" [(ngModel)]="form.name" maxlength="100" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('customers.identity') }}</mat-label><input matInput name="i" [(ngModel)]="form.identity" autocomplete="off" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('customers.mobile') }}</mat-label><input matInput name="m" [(ngModel)]="form.mobileNumber" inputmode="tel" dir="ltr" /></mat-form-field>
        <div class="wide row"><span class="spacer"></span><button mat-flat-button class="btn-primary" type="submit">{{ i18n.t('common.save') }}</button></div>
      </form>
    }
    <form class="row" (ngSubmit)="load(1)">
      <mat-form-field class="q"><mat-label>{{ i18n.t('common.search') }}</mat-label><input matInput name="q" [(ngModel)]="q" /></mat-form-field>
      <mat-form-field class="q"><mat-label>{{ i18n.t('customers.identity') }}</mat-label><input matInput name="id" [(ngModel)]="identity" dir="ltr" autocomplete="off" /></mat-form-field>
      <button mat-stroked-button type="submit">{{ i18n.t('common.search') }}</button>
    </form>
    <section class="panel">
      @if (page(); as p) {
        @if (p.items.length === 0) { <app-empty-state [message]="i18n.t('common.noResults')" /> } @else {
          <table class="data">
            <thead><tr><th>{{ i18n.t('users.name') }}</th><th>{{ i18n.t('customers.type') }}</th><th>{{ i18n.t('customers.identity') }}</th><th>{{ i18n.t('customers.mobile') }}</th><th>{{ i18n.t('common.date') }}</th><th></th></tr></thead>
            <tbody>
              @for (c of p.items; track c.id) {
                <tr>
                  <td>{{ c.name ?? '—' }}</td><td>{{ i18n.t('customers.type.' + c.buyerType) }}</td>
                  <td class="num" dir="ltr">{{ c.identityLast4 ? '••••' + c.identityLast4 : '—' }}</td><td class="num" dir="ltr">{{ c.mobileNumber ?? '—' }}</td>
                  <td>{{ c.lastPurchaseAt | localDate:false }}</td>
                  <td>@if (auth.can('customers:manage')) { <button mat-button (click)="anonymize(c)">{{ i18n.t('customers.anonymize') }}</button> }</td>
                </tr>
              }
            </tbody>
          </table>
          <app-paginator [page]="p.page" [totalPages]="p.totalPages" (pageChange)="load($event)" />
        }
      } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
    </section>
  `,
  styles: `header h1 { margin: 0; } .q { width: 260px; } .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 16px; margin-bottom: 16px; } .wide { grid-column: 1 / -1; }`,
})
export class CustomersPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);
  readonly page = signal<Page<Customer> | null>(null);
  readonly showForm = signal(false);
  q = '';
  identity = '';
  form = { buyerType: 'P' as 'P' | 'B' | 'F', name: '', identity: '', mobileNumber: '' };

  constructor() {
    this.load(1);
  }
  load(page: number): void {
    this.api.get<Page<Customer>>('/customers', { page, pageSize: 25, q: this.q.trim(), identity: this.identity.trim() }).subscribe({ next: (p) => this.page.set(p), error: (e) => this.notify.error(e) });
  }
  create(): void {
    const f = this.form;
    const body = { buyerType: f.buyerType, ...(f.name ? { name: f.name.trim() } : {}), ...(f.identity ? { identity: f.identity.trim() } : {}), ...(f.mobileNumber ? { mobileNumber: f.mobileNumber.trim() } : {}) };
    this.api.post<{ possibleDuplicates: Array<{ id: string }> }>('/customers', body).subscribe({
      next: (r) => {
        if (r.possibleDuplicates.length) this.notify.warn(this.i18n.t('customers.duplicates'));
        else this.notify.success(this.i18n.t('company.saved'));
        this.form = { buyerType: 'P', name: '', identity: '', mobileNumber: '' };
        this.showForm.set(false);
        this.load(1);
      },
      error: (e: HttpErrorResponse) => this.notify.error(e),
    });
  }
  anonymize(c: Customer): void {
    this.dialog.open(ConfirmDialog, { data: { title: this.i18n.t('customers.anonymize'), message: this.i18n.t('customers.anonymizeConfirm'), confirm: this.i18n.t('common.confirm'), cancel: this.i18n.t('common.cancel') } })
      .afterClosed().subscribe((ok) => ok && this.api.post(`/customers/${c.id}/anonymize`).subscribe({ next: () => this.load(this.page()?.page ?? 1), error: (e) => this.notify.error(e) }));
  }
}
