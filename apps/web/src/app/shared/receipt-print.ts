import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { Receipt } from '../core/api/models';
import { I18nService } from '../core/i18n/i18n.service';
import { EtaStamp } from './eta-stamp';
import { LocalDatePipe, MoneyPipe } from './money.pipe';

/**
 * Printable 80 mm receipt. Unless the receipt is VALID at ETA it carries an
 * explicit "internal receipt — not registered" statement, and no QR code is
 * printed (the official QR format has not been verified; see compliance matrix).
 */
@Component({
  selector: 'app-receipt-print',
  imports: [EtaStamp, MoneyPipe, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = receipt();
    <article class="slip" [attr.dir]="i18n.lang() === 'ar' ? 'rtl' : 'ltr'">
      <header>
        <strong class="seller">{{ r.seller.companyTradeName }}</strong>
        <div class="small">{{ i18n.t('company.rin') }}: <span class="num">{{ r.seller.rin }}</span></div>
        <div class="small">{{ r.seller.branchAddress['street'] }} {{ r.seller.branchAddress['buildingNumber'] }}، {{ r.seller.branchAddress['regionCity'] }}</div>
      </header>
      <div class="meta">
        <div class="kind"><span>{{ i18n.t('receipts.kind.' + r.kind) }}</span><span class="num">{{ r.receiptNumber }}</span>@if (copy()) { <span> ({{ i18n.t('receipts.copy') }})</span> }</div>
        <div class="small">{{ r.dateTimeIssued | localDate }}</div>
        @if (r.buyer.name) { <div class="small">{{ i18n.t('receipts.buyer') }}: {{ r.buyer.name }}</div> }
      </div>
      <table>
        <tbody>
          @for (l of r.lines; track l.lineNo) {
            <tr><td colspan="2">{{ l.description }}</td></tr>
            <tr class="small"><td class="num">{{ l.quantity }} × {{ l.unitPrice | money }}</td><td class="end money">{{ l.total | money }}</td></tr>
            @if (l.commercialDiscount) { <tr class="small muted"><td>{{ l.commercialDiscount.description }}</td><td class="end money">-{{ l.commercialDiscount.amount | money }}</td></tr> }
          }
        </tbody>
      </table>
      <table class="totals">
        <tbody>
          <tr><td>{{ i18n.t('pos.subtotal') }}</td><td class="end money">{{ r.totals.netAmount | money }}</td></tr>
          @for (t of r.totals.taxTotals; track t.taxType) { <tr><td>{{ i18n.t('pos.tax') }} {{ t.taxType }}</td><td class="end money">{{ t.amount | money }}</td></tr> }
          @if (r.totals.extraReceiptDiscount) { <tr><td>{{ r.totals.extraReceiptDiscount.description }}</td><td class="end money">-{{ r.totals.extraReceiptDiscount.amount | money }}</td></tr> }
          <tr class="grand"><td>{{ i18n.t('common.total') }}</td><td class="end money">{{ r.totals.totalAmount | money }}</td></tr>
        </tbody>
      </table>
      <footer>
        <app-eta-stamp [status]="r.eta.status" [large]="true" />
        @if (!r.registration.officiallyRegistered) {
          <p class="internal">{{ i18n.t('receipts.internalOnly') }}</p>
        }
        <p class="uuid small num" dir="ltr">{{ r.uuid }}</p>
        @if (r.eta.longId) { <p class="small num" dir="ltr">{{ r.eta.longId }}</p> }
      </footer>
    </article>
  `,
  styles: `
    .slip { width: 80mm; max-width: 100%; background: #fff; color: #000; padding: 14px 12px; margin-inline: auto; border: 1px dashed var(--line); font-size: 13px; }
    header { text-align: center; margin-bottom: 8px; }
    .seller { font-size: 16px; }
    .small { font-size: 11.5px; }
    .muted { color: #555; }
    .kind { display: flex; gap: 6px; flex-wrap: wrap; }
    .meta { border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 6px 0; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; }
    .end { text-align: end; }
    .totals { border-top: 1px dashed #999; margin-top: 6px; padding-top: 4px; }
    .grand td { font-weight: 700; font-size: 15px; padding-top: 4px; }
    footer { text-align: center; margin-top: 12px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .internal { font-weight: 700; margin: 0; }
    .uuid { word-break: break-all; margin: 0; }
    @media print { .slip { border: none; width: 80mm; } }
  `,
})
export class ReceiptPrint {
  readonly i18n = inject(I18nService);
  readonly receipt = input.required<Receipt>();
  readonly copy = input(false);
}
