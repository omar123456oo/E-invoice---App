import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { EtaStatus, Page, Receipt } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { EtaStamp } from '../../shared/eta-stamp';
import { LocalDatePipe, MoneyPipe } from '../../shared/money.pipe';
import { Paginator } from '../../shared/paginator';

const STATUSES: EtaStatus[] = ['NOT_SUBMITTED', 'QUEUED', 'SUBMITTED', 'UNKNOWN', 'VALID', 'REJECTED', 'INVALID', 'FAILED', 'CANCELLED'];

@Component({
  selector: 'app-receipt-list',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, EtaStamp, MoneyPipe, LocalDatePipe, Paginator, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ i18n.t('receipts.title') }}</h1>
    <form class="row filters" (ngSubmit)="load(1)">
      <mat-form-field><mat-label>{{ i18n.t('receipts.number') }}</mat-label><input matInput name="n" [(ngModel)]="receiptNumber" dir="ltr" /></mat-form-field>
      <mat-form-field>
        <mat-label>{{ i18n.t('common.status') }}</mat-label>
        <mat-select name="s" [(ngModel)]="etaStatus" (selectionChange)="load(1)">
          <mat-option value="">—</mat-option>
          @for (s of statuses; track s) { <mat-option [value]="s">{{ i18n.t('eta.status.' + s) }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>{{ i18n.t('products.kind') }}</mat-label>
        <mat-select name="k" [(ngModel)]="kind" (selectionChange)="load(1)">
          <mat-option value="">—</mat-option>
          <mat-option value="SALE">{{ i18n.t('receipts.kind.SALE') }}</mat-option>
          <mat-option value="RETURN">{{ i18n.t('receipts.kind.RETURN') }}</mat-option>
        </mat-select>
      </mat-form-field>
      <button mat-stroked-button type="submit">{{ i18n.t('common.search') }}</button>
    </form>
    <section class="panel">
      @if (page(); as p) {
        @if (p.items.length === 0) { <app-empty-state [message]="i18n.t('common.noResults')" /> } @else {
          <table class="data">
            <thead><tr><th>{{ i18n.t('receipts.number') }}</th><th>{{ i18n.t('common.date') }}</th><th>{{ i18n.t('products.kind') }}</th><th>{{ i18n.t('common.status') }}</th><th class="end">{{ i18n.t('common.total') }}</th></tr></thead>
            <tbody>
              @for (r of p.items; track r.id) {
                <tr class="clickable" tabindex="0" (click)="open(r)" (keydown.enter)="open(r)">
                  <td class="num">{{ r.receiptNumber }}</td><td>{{ r.dateTimeIssued | localDate }}</td><td>{{ i18n.t('receipts.kind.' + r.kind) }}</td>
                  <td><app-eta-stamp [status]="r.eta.status" /></td><td class="end money">{{ r.totals.totalAmount | money }}</td>
                </tr>
              }
            </tbody>
          </table>
          <app-paginator [page]="p.page" [totalPages]="p.totalPages" (pageChange)="load($event)" />
        }
      } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
    </section>
  `,
  styles: `.filters mat-form-field { width: 200px; }`,
})
export class ReceiptListPage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  readonly statuses = STATUSES;
  readonly page = signal<Page<Receipt> | null>(null);
  receiptNumber = '';
  etaStatus = '';
  kind = '';

  /** Optional ?etaStatus= filter, e.g. from a notification link. */
  readonly etaStatusParam = input<string>(undefined, { alias: 'etaStatus' });

  constructor() {
    queueMicrotask(() => {
      if (this.etaStatusParam()) this.etaStatus = this.etaStatusParam()!;
      this.load(1);
    });
  }

  load(page: number): void {
    this.api.get<Page<Receipt>>('/receipts', { page, pageSize: 25, receiptNumber: this.receiptNumber.trim(), etaStatus: this.etaStatus, kind: this.kind }).subscribe({
      next: (p) => this.page.set(p),
      error: (e) => this.notify.error(e),
    });
  }

  open(r: Receipt): void {
    void this.router.navigate(['/receipts', r.id]);
  }
}
