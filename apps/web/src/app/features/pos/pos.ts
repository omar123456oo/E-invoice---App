import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { ApiErrorBody, CheckoutResult, Page, PaymentMethod, PosDevice, Product, Receipt, Shift } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { MoneyPipe } from '../../shared/money.pipe';
import { fromPiastres, isDecimal, toPiastres } from '../../shared/money';
import { ReceiptPrint } from '../../shared/receipt-print';
import { PosCartStore } from './pos-cart.store';

const DEVICE_KEY = 'ereceipt.pos.device';
interface Tender { method: PaymentMethod; amount: string; reference: string }

@Component({
  selector: 'app-pos',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MoneyPipe, ReceiptPrint],
  providers: [PosCartStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos.html',
  styleUrl: './pos.scss',
})
export class PosPage {
  readonly i18n = inject(I18nService);
  readonly cart = inject(PosCartStore);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  readonly devices = signal<PosDevice[]>([]);
  readonly deviceId = signal<string>(this.storedDevice());
  readonly shift = signal<Shift | null>(null);
  readonly shiftLoaded = signal(false);
  readonly closing = signal(false);
  readonly closedShift = signal<Shift | null>(null);
  openingCash = '0.00';
  countedCash = '';

  query = '';
  readonly results = signal<Product[]>([]);

  readonly method = signal<PaymentMethod>('CASH');
  tendered = '';
  reference = '';
  readonly split = signal<Tender[]>([]);
  readonly buyerNeeded = signal(false);
  buyerName = '';
  buyerId = '';
  readonly busy = signal(false);
  readonly done = signal<CheckoutResult | null>(null);

  readonly total = computed(() => this.cart.quote()?.totals.totalAmount ?? null);
  readonly taxTotal = computed(() => {
    const t = this.cart.quote()?.totals.taxTotals ?? [];
    return fromPiastres(t.reduce((a, x) => a + toPiastres(x.amount), 0n));
  });
  /** Display-only change, integer piastres. The server computes the authoritative change. */
  readonly change = signal<string | null>(null);

  constructor() {
    this.api.get<PosDevice[]>('/pos-devices').subscribe({
      next: (d) => {
        const active = d.filter((x) => x.status === 'ACTIVE');
        this.devices.set(active);
        if (!active.some((x) => x.id === this.deviceId()) && active[0]) this.selectDevice(active[0].id);
      },
      error: (e) => this.notify.error(e),
    });
    this.loadShift();
  }

  private storedDevice(): string {
    try {
      return localStorage.getItem(DEVICE_KEY) ?? '';
    } catch {
      return '';
    }
  }

  selectDevice(id: string): void {
    this.deviceId.set(id);
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      /* not remembered */
    }
  }

  loadShift(): void {
    this.api.get<{ shift: Shift | null }>('/pos/shifts/current').subscribe({
      next: (r) => {
        this.shift.set(r.shift);
        this.shiftLoaded.set(true);
        if (r.shift) this.selectDevice(r.shift.deviceId);
      },
      error: (e) => this.notify.error(e),
    });
  }

  openShift(): void {
    if (!isDecimal(this.openingCash)) return;
    this.api.post<Shift>('/pos/shifts', { deviceId: this.deviceId(), openingCash: this.openingCash }).subscribe({
      next: (s) => {
        this.shift.set(s);
        this.closedShift.set(null);
        queueMicrotask(() => this.focusSearch());
      },
      error: (e) => this.notify.error(e),
    });
  }

  closeShift(): void {
    const s = this.shift();
    if (!s || !isDecimal(this.countedCash)) return;
    this.api.post<Shift>(`/pos/shifts/${s.id}/close`, { countedCash: this.countedCash }).subscribe({
      next: (closed) => {
        this.closedShift.set(closed);
        this.shift.set(null);
        this.closing.set(false);
        this.countedCash = '';
        this.notify.success(this.i18n.t('pos.shiftClosed'));
      },
      error: (e) => this.notify.error(e),
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key === 'F2') {
      e.preventDefault();
      this.focusSearch();
    } else if (e.key === 'F9') {
      e.preventDefault();
      this.complete();
    } else if (e.key === 'Escape' && this.done()) {
      this.newSale();
    }
  }

  focusSearch(): void {
    this.searchInput()?.nativeElement.focus();
  }

  /** Enter: exact barcode first, then the single search match. */
  scan(): void {
    const q = this.query.trim();
    if (!q) return;
    if (/^[0-9A-Za-z-]{4,64}$/.test(q)) {
      this.api.get<Product>(`/products/barcode/${encodeURIComponent(q)}`).subscribe({
        next: (p) => this.addProduct(p),
        error: () => this.search(true),
      });
    } else this.search(true);
  }

  search(addIfSingle = false): void {
    const q = this.query.trim();
    if (q.length < 2) {
      this.results.set([]);
      return;
    }
    this.api.get<Page<Product>>('/products', { q, active: 'true', pageSize: 12 }).subscribe({
      next: (r) => {
        if (addIfSingle && r.items.length === 1) this.addProduct(r.items[0]!);
        else this.results.set(r.items);
      },
      error: (e) => this.notify.error(e),
    });
  }

  addProduct(p: Product): void {
    if (this.done()) this.newSale();
    this.cart.add(p);
    this.query = '';
    this.results.set([]);
    this.focusSearch();
  }

  name(p: Product): string {
    return this.i18n.lang() === 'en' && p.nameEn ? p.nameEn : p.nameAr;
  }

  updateChange(): void {
    const total = this.total();
    if (!total || !isDecimal(this.tendered)) {
      this.change.set(null);
      return;
    }
    const diff = toPiastres(this.tendered) - toPiastres(total);
    this.change.set(diff >= 0n ? fromPiastres(diff) : null);
  }

  addSplit(): void {
    const total = this.total();
    if (!total) return;
    const paid = this.split().reduce((a, t) => a + (isDecimal(t.amount) ? toPiastres(t.amount) : 0n), 0n);
    const remaining = toPiastres(total) - paid;
    this.split.update((s) => [...s, { method: s.length === 0 ? 'CASH' : 'CARD', amount: remaining > 0n ? fromPiastres(remaining) : '0.00', reference: '' }]);
  }

  splitRemaining(): string | null {
    const total = this.total();
    if (!total) return null;
    const paid = this.split().reduce((a, t) => a + (isDecimal(t.amount) ? toPiastres(t.amount) : 0n), 0n);
    return fromPiastres(toPiastres(total) - paid);
  }

  private payments(): Array<{ method: PaymentMethod; amount: string; tendered?: string; reference?: string }> | null {
    const total = this.total();
    if (!total) return null;
    if (this.split().length) {
      return this.split().map((t) => ({ method: t.method, amount: t.amount, ...(t.reference ? { reference: t.reference } : {}) }));
    }
    const m = this.method();
    if (m === 'CASH') return [{ method: m, amount: total, ...(isDecimal(this.tendered) ? { tendered: this.tendered } : {}) }];
    return [{ method: m, amount: total, ...(this.reference ? { reference: this.reference.trim() } : {}) }];
  }

  complete(): void {
    const payments = this.payments();
    if (!payments || this.busy() || this.cart.isEmpty() || !this.shift() || this.cart.quoting()) return;
    this.busy.set(true);
    const body = {
      deviceId: this.deviceId(),
      items: this.cart.toItems(),
      payments,
      ...(this.buyerNeeded() && this.buyerId ? { buyer: { type: 'P', name: this.buyerName.trim(), identity: this.buyerId.trim() } } : {}),
    };
    this.api.post<CheckoutResult>('/pos/checkout', body, { 'Idempotency-Key': this.cart.idempotencyKey() }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.done.set(r);
        this.notify.success(this.i18n.t('pos.saleDone'));
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const code = err instanceof HttpErrorResponse ? (err.error as ApiErrorBody | null)?.error?.code : undefined;
        if (code === 'BUYER_IDENTITY_REQUIRED') this.buyerNeeded.set(true);
        this.notify.error(err);
      },
    });
  }

  notifyText(err: unknown): string {
    return this.notify.describe(err);
  }

  print(receipt: Receipt): void {
    this.api.post(`/receipts/${receipt.id}/print`).subscribe({ next: () => window.print(), error: (e) => this.notify.error(e) });
  }

  newSale(): void {
    this.cart.reset();
    this.done.set(null);
    this.split.set([]);
    this.tendered = '';
    this.reference = '';
    this.change.set(null);
    this.method.set('CASH');
    this.buyerNeeded.set(false);
    this.buyerName = '';
    this.buyerId = '';
    queueMicrotask(() => this.focusSearch());
  }
}
