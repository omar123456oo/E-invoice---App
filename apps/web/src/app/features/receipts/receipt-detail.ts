import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { ApiService } from '../../core/api/api.service';
import type { ReceiptDetail } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EtaStamp } from '../../shared/eta-stamp';
import { LocalDatePipe, MoneyPipe } from '../../shared/money.pipe';
import { ReceiptPrint } from '../../shared/receipt-print';

@Component({
  selector: 'app-receipt-detail',
  imports: [RouterLink, MatButtonModule, EtaStamp, MoneyPipe, LocalDatePipe, ReceiptPrint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (receipt(); as r) {
      <header class="row no-print">
        <h1>{{ i18n.t('receipts.kind.' + r.kind) }} <span class="num">{{ r.receiptNumber }}</span></h1>
        <span class="spacer"></span>
        @if (auth.can('receipts:reprint')) { <button mat-stroked-button (click)="print()">{{ i18n.t('receipts.print') }}</button> }
        @if (canReturn()) { <a mat-stroked-button [routerLink]="['/returns/new', r.id]">{{ i18n.t('receipts.return') }}</a> }
        @if (auth.can('receipts:submit')) {
          @if (r.eta.status === 'NOT_SUBMITTED') { <button mat-flat-button class="btn-primary" (click)="submit()">{{ i18n.t('receipts.submit') }}</button> }
          @if (r.eta.status === 'FAILED') { <button mat-flat-button class="btn-primary" (click)="submit()">{{ i18n.t('receipts.requeue') }}</button> }
          @if (r.eta.status === 'UNKNOWN') { <button mat-flat-button class="btn-primary" (click)="reconcile()">{{ i18n.t('receipts.reconcile') }}</button> }
        }
      </header>

      <div class="layout">
        <div class="stack no-print">
          <section class="panel status">
            <app-eta-stamp [status]="r.eta.status" [large]="true" />
            <p>{{ i18n.lang() === 'ar' ? r.registration.label.ar : r.registration.label.en }}</p>
            @if (r.eta.lastError; as err) {
              @if (err.message || err.code) { <p class="error-text"><strong>{{ i18n.t('receipts.lastError') }}:</strong> {{ err.message ?? err.code }}</p> }
            }
            <dl>
              <dt>{{ i18n.t('receipts.uuid') }}</dt><dd class="num mono" dir="ltr">{{ r.uuid }}</dd>
              @if (r.eta.longId) { <dt>{{ i18n.t('receipts.longId') }}</dt><dd class="num" dir="ltr">{{ r.eta.longId }}</dd> }
              @if (r.eta.submissionUuid) { <dt>{{ i18n.t('receipts.submission') }}</dt><dd class="num" dir="ltr">{{ r.eta.submissionUuid }}</dd> }
              @if (r.referenceUUID) { <dt>{{ i18n.t('receipts.reference') }}</dt><dd class="num" dir="ltr"><a [routerLink]="['/receipts', r.originalReceiptId]">{{ r.referenceUUID }}</a></dd> }
            </dl>
          </section>

          <section class="panel">
            <h2>{{ i18n.t('receipts.lines') }}</h2>
            <table class="data">
              <thead><tr><th>#</th><th></th><th class="end">{{ i18n.t('pos.qty') }}</th><th class="end">{{ i18n.t('pos.price') }}</th><th class="end">{{ i18n.t('pos.tax') }}</th><th class="end">{{ i18n.t('common.total') }}</th></tr></thead>
              <tbody>
                @for (l of r.lines; track l.lineNo) {
                  <tr>
                    <td class="num">{{ l.lineNo }}</td>
                    <td>{{ l.description }}<div class="muted small num" dir="ltr">{{ l.itemType }} {{ l.itemCode }}</div></td>
                    <td class="end num">{{ l.quantity }}@if (l.returnedQuantity !== '0') { <div class="muted small">↩ {{ l.returnedQuantity }}</div> }</td>
                    <td class="end money">{{ l.unitPrice | money }}</td>
                    <td class="end money">@for (t of l.taxableItems; track t.taxType) { <div>{{ t.amount | money }} <span class="muted small">{{ t.taxType }} {{ t.rate }}%</span></div> }</td>
                    <td class="end money">{{ l.total | money }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>

          <section class="panel">
            <h2>{{ i18n.t('receipts.payments') }}</h2>
            <table class="data">
              <tbody>
                @for (p of r.payments; track p.id) {
                  <tr><td>{{ i18n.t('pay.' + p.method) }}</td><td class="muted">{{ i18n.t('paystatus.' + p.status) }}</td><td class="muted num" dir="ltr">{{ p.reference }}</td><td class="end money">{{ p.amount | money }}</td></tr>
                }
              </tbody>
            </table>
            @if (r.returnReceipts.length) {
              <h3>{{ i18n.t('receipts.linkedReturns') }}</h3>
              <table class="data">
                <tbody>
                  @for (x of r.returnReceipts; track x.id) {
                    <tr class="clickable" [routerLink]="['/receipts', x.id]"><td class="num">{{ x.receiptNumber }}</td><td><app-eta-stamp [status]="x.eta.status" /></td><td class="end money">{{ x.totals.totalAmount | money }}</td></tr>
                  }
                </tbody>
              </table>
            }
          </section>

          <section class="panel">
            <h2>{{ i18n.t('receipts.history') }}</h2>
            <ol class="history">
              @for (h of r.eta.history; track $index) {
                <li><span class="muted">{{ h.at | localDate }}</span> <app-eta-stamp [status]="$any(h.to)" /> <span class="small">{{ h.reason }}</span></li>
              }
            </ol>
          </section>
        </div>
        <aside class="print-col"><app-receipt-print [receipt]="r" [copy]="r.printCount > 0" /></aside>
      </div>
    } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
  `,
  styles: `
    header h1 { margin: 0; }
    .layout { display: grid; grid-template-columns: 1fr 320px; gap: 20px; margin-top: 16px; align-items: start; }
    .status { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
    dt { color: var(--muted); } dd { margin: 0; word-break: break-all; }
    .small { font-size: 0.8rem; }
    .history { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .history li { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    @media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } }
    @media print { .layout { display: block; } }
  `,
})
export class ReceiptDetailPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);
  readonly id = input.required<string>();
  readonly receipt = signal<ReceiptDetail | null>(null);
  readonly canReturn = computed(() => {
    const r = this.receipt();
    return !!r && r.kind === 'SALE' && r.returnStatus !== 'FULL' && this.auth.can('returns:create') && !['REJECTED', 'INVALID', 'FAILED', 'CANCELLED', 'SUPERSEDED'].includes(r.eta.status);
  });

  constructor() {
    effect(() => this.load(this.id()));
  }

  load(id: string): void {
    this.api.get<ReceiptDetail>(`/receipts/${id}`).subscribe({ next: (r) => this.receipt.set(r), error: (e) => this.notify.error(e) });
  }

  print(): void {
    this.api.post(`/receipts/${this.id()}/print`).subscribe({
      next: () => {
        window.print();
        this.load(this.id());
      },
      error: (e) => this.notify.error(e),
    });
  }

  submit(): void {
    this.dialog
      .open(ConfirmDialog, { data: { title: this.i18n.t('receipts.submit'), message: this.receipt()!.receiptNumber, confirm: this.i18n.t('common.confirm'), cancel: this.i18n.t('common.cancel') } })
      .afterClosed()
      .subscribe((ok) => {
        if (!ok) return;
        this.api.post(`/receipts/${this.id()}/submit`, { reason: 'Submitted from receipt screen' }).subscribe({ next: () => this.load(this.id()), error: (e) => this.notify.error(e) });
      });
  }

  reconcile(): void {
    this.api.post(`/receipts/${this.id()}/reconcile`).subscribe({ next: () => this.load(this.id()), error: (e) => this.notify.error(e) });
  }
}
