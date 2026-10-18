import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { Page, PosDevice, ReturnRecord } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { LocalDatePipe, MoneyPipe } from '../../shared/money.pipe';
import { Paginator } from '../../shared/paginator';

@Component({
  selector: 'app-return-list',
  imports: [FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatSelectModule, MoneyPipe, LocalDatePipe, Paginator, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row"><h1>{{ i18n.t('returns.title') }}</h1><span class="spacer"></span>
      <mat-form-field>
        <mat-label>{{ i18n.t('common.status') }}</mat-label>
        <mat-select [(ngModel)]="status" (selectionChange)="load(1)">
          <mat-option value="">—</mat-option>
          @for (s of ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED']; track s) { <mat-option [value]="s">{{ i18n.t('returns.status.' + s) }}</mat-option> }
        </mat-select>
      </mat-form-field>
    </header>
    <section class="panel">
      @if (page(); as p) {
        @if (p.items.length === 0) { <app-empty-state [message]="i18n.t('common.noResults')" /> } @else {
          <table class="data">
            <thead><tr><th>{{ i18n.t('common.date') }}</th><th>{{ i18n.t('common.reason') }}</th><th>{{ i18n.t('common.status') }}</th><th class="end">{{ i18n.t('returns.estimated') }}</th><th>{{ i18n.t('common.actions') }}</th></tr></thead>
            <tbody>
              @for (r of p.items; track r.id) {
                <tr>
                  <td>{{ r.createdAt | localDate }}</td>
                  <td>{{ r.reason }} <a class="small" [routerLink]="['/receipts', r.originalReceiptId]">{{ i18n.t('returns.original') }}</a></td>
                  <td>{{ i18n.t('returns.status.' + r.status) }}@if (r.requiresApprovalReasons.length) { <div class="muted small">{{ r.requiresApprovalReasons.join(', ') }}</div> }</td>
                  <td class="end money">{{ r.estimatedRefund | money }}</td>
                  <td class="row">
                    @if (r.status === 'PENDING_APPROVAL' && auth.can('returns:approve')) {
                      <button mat-stroked-button (click)="decide(r, true)">{{ i18n.t('returns.approve') }}</button>
                      <button mat-button (click)="decide(r, false)">{{ i18n.t('returns.reject') }}</button>
                    }
                    @if (r.status === 'APPROVED' && auth.can('returns:create') && devices().length) {
                      <mat-select class="dev" [(ngModel)]="deviceId" [attr.aria-label]="i18n.t('pos.device')">
                        @for (d of devices(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
                      </mat-select>
                      <button mat-flat-button class="btn-primary" (click)="complete(r)">{{ i18n.t('returns.complete') }}</button>
                    }
                    @if (r.returnReceiptId) { <a mat-button [routerLink]="['/receipts', r.returnReceiptId]">{{ i18n.t('receipts.kind.RETURN') }}</a> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <app-paginator [page]="p.page" [totalPages]="p.totalPages" (pageChange)="load($event)" />
        }
      } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
    </section>
  `,
  styles: `header h1 { margin: 0; } .small { font-size: 0.8rem; } .dev { width: 150px; }`,
})
export class ReturnListPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly page = signal<Page<ReturnRecord> | null>(null);
  readonly devices = signal<PosDevice[]>([]);
  status = '';
  deviceId = '';

  constructor() {
    this.load(1);
    this.api.get<PosDevice[]>('/pos-devices').subscribe({
      next: (d) => {
        const active = d.filter((x) => x.status === 'ACTIVE');
        this.devices.set(active);
        this.deviceId = active[0]?.id ?? '';
      },
      error: () => undefined,
    });
  }

  load(page: number): void {
    this.api.get<Page<ReturnRecord>>('/returns', { page, pageSize: 25, status: this.status }).subscribe({ next: (p) => this.page.set(p), error: (e) => this.notify.error(e) });
  }

  decide(r: ReturnRecord, approve: boolean): void {
    this.api.post(`/returns/${r.id}/decision`, { approve }).subscribe({ next: () => this.load(this.page()?.page ?? 1), error: (e) => this.notify.error(e) });
  }

  complete(r: ReturnRecord): void {
    this.api.post(`/returns/${r.id}/complete`, { deviceId: this.deviceId }).subscribe({
      next: () => {
        this.notify.success(this.i18n.t('returns.done'));
        this.load(this.page()?.page ?? 1);
      },
      error: (e) => this.notify.error(e),
    });
  }
}
