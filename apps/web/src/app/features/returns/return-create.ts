import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService, newIdempotencyKey } from '../../core/api/api.service';
import type { PaymentMethod, PosDevice, ReceiptDetail, ReturnRecord } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { MoneyPipe } from '../../shared/money.pipe';

interface Pick { lineNo: number; description: string; max: string; quantity: string }

/** Return quantities are chosen here; refund amounts are calculated by the server from the original receipt. */
@Component({
  selector: 'app-return-create',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ i18n.t('returns.new') }}</h1>
    @if (receipt(); as r) {
      <section class="panel stack">
        <p>{{ i18n.t('returns.original') }}: <strong class="num">{{ r.receiptNumber }}</strong> — <span class="money">{{ r.totals.totalAmount | money }}</span></p>
        <table class="data">
          <thead><tr><th></th><th class="end">{{ i18n.t('returns.returnable') }}</th><th>{{ i18n.t('pos.qty') }}</th></tr></thead>
          <tbody>
            @for (p of picks(); track p.lineNo) {
              <tr><td>{{ p.description }}</td><td class="end num">{{ p.max }}</td>
                <td><input class="q num" [(ngModel)]="p.quantity" inputmode="decimal" [attr.aria-label]="i18n.t('pos.qty') + ' ' + p.description" /></td></tr>
            }
          </tbody>
        </table>
        <div class="row">
          <mat-form-field class="grow"><mat-label>{{ i18n.t('common.reason') }}</mat-label><input matInput [(ngModel)]="reason" maxlength="500" required /></mat-form-field>
          <mat-form-field>
            <mat-label>{{ i18n.t('returns.refundMethod') }}</mat-label>
            <mat-select [(ngModel)]="refundMethod">@for (m of methods; track m) { <mat-option [value]="m">{{ i18n.t('pay.' + m) }}</mat-option> }</mat-select>
          </mat-form-field>
          @if (refundMethod !== 'CASH') { <mat-form-field><mat-label>{{ i18n.t('returns.refundRef') }}</mat-label><input matInput [(ngModel)]="refundReference" maxlength="40" dir="ltr" /></mat-form-field> }
        </div>
        <div class="row"><span class="spacer"></span><button mat-flat-button class="btn-primary" [disabled]="busy()" (click)="submit()">{{ i18n.t('returns.request') }}</button></div>
      </section>
      @if (created(); as c) {
        <section class="panel stack result">
          <p>{{ i18n.t('returns.status.' + c.status) }} — {{ i18n.t('returns.estimated') }} <strong class="money">{{ c.estimatedRefund | money }}</strong></p>
          @if (c.status === 'PENDING_APPROVAL') { <p class="muted">{{ i18n.t('returns.approvalReasons') }}: {{ c.requiresApprovalReasons.join(', ') }}</p> }
          @if (c.status === 'APPROVED') {
            <div class="row">
              <mat-form-field><mat-label>{{ i18n.t('pos.device') }}</mat-label>
                <mat-select [(ngModel)]="deviceId">@for (d of devices(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }</mat-select>
              </mat-form-field>
              <button mat-flat-button class="btn-primary" [disabled]="busy() || !deviceId" (click)="complete(c)">{{ i18n.t('returns.complete') }}</button>
            </div>
          }
        </section>
      }
    } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
  `,
  styles: `.q { width: 80px; padding: 6px; border: 1px solid var(--line); border-radius: var(--radius-s); font: inherit; } .grow { flex: 1; min-width: 240px; } .result { margin-top: 16px; }`,
})
export class ReturnCreatePage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  readonly receiptId = input.required<string>();
  readonly receipt = signal<ReceiptDetail | null>(null);
  readonly picks = signal<Pick[]>([]);
  readonly devices = signal<PosDevice[]>([]);
  readonly created = signal<ReturnRecord | null>(null);
  readonly busy = signal(false);
  readonly methods: PaymentMethod[] = ['CASH', 'CARD', 'WALLET'];
  reason = '';
  refundMethod: PaymentMethod = 'CASH';
  refundReference = '';
  deviceId = '';
  private readonly key = newIdempotencyKey();

  constructor() {
    effect(() => {
      this.api.get<ReceiptDetail>(`/receipts/${this.receiptId()}`).subscribe({
        next: (r) => {
          this.receipt.set(r);
          this.picks.set(r.lines.map((l) => ({ lineNo: l.lineNo, description: l.description, max: trimQty(Number(l.quantity) - Number(l.returnedQuantity)), quantity: '' })));
        },
        error: (e) => this.notify.error(e),
      });
    });
    this.api.get<PosDevice[]>('/pos-devices').subscribe({
      next: (d) => {
        const a = d.filter((x) => x.status === 'ACTIVE');
        this.devices.set(a);
        this.deviceId = a[0]?.id ?? '';
      },
      error: () => undefined,
    });
  }

  submit(): void {
    const lines = this.picks().filter((p) => p.quantity && Number(p.quantity) > 0).map((p) => ({ lineNo: p.lineNo, quantity: p.quantity.trim() }));
    if (!lines.length || this.reason.trim().length < 3) {
      this.notify.warn(this.i18n.t('error.required'));
      return;
    }
    this.busy.set(true);
    const body = { originalReceiptId: this.receiptId(), lines, reason: this.reason.trim(), refundMethod: this.refundMethod, ...(this.refundReference ? { refundReference: this.refundReference.trim() } : {}) };
    this.api.post<{ return: ReturnRecord }>('/returns', body, { 'Idempotency-Key': this.key }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.created.set(r.return);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }

  complete(c: ReturnRecord): void {
    this.busy.set(true);
    this.api.post<{ receipt: { id: string } }>(`/returns/${c.id}/complete`, { deviceId: this.deviceId }).subscribe({
      next: (r) => {
        this.notify.success(this.i18n.t('returns.done'));
        void this.router.navigate(['/receipts', r.receipt.id]);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
}

function trimQty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
