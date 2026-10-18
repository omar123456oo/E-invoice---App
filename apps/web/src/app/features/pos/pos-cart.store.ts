import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, switchMap } from 'rxjs/operators';
import { ApiService, newIdempotencyKey } from '../../core/api/api.service';
import type { Product, Quote } from '../../core/api/models';

export interface CartLine {
  product: Product;
  quantity: string;
  discountRate: string;
}

/**
 * Cart state for one POS session. Totals are never computed here: every
 * change is priced by POST /pos/quote, and checkout recalculates again on
 * the server. The idempotency key lives for the whole cart, so a retried
 * checkout after a network error cannot create a second sale.
 */
@Injectable()
export class PosCartStore {
  private readonly api = inject(ApiService);
  readonly lines = signal<CartLine[]>([]);
  readonly quote = signal<Quote | null>(null);
  readonly quoting = signal(false);
  readonly quoteError = signal<unknown>(null);
  readonly idempotencyKey = signal(newIdempotencyKey());
  readonly isEmpty = computed(() => this.lines().length === 0);
  private readonly changes = new Subject<CartLine[]>();

  constructor() {
    const sub = this.changes
      .pipe(
        debounceTime(150),
        switchMap((lines) => {
          if (lines.length === 0) return of(null);
          this.quoting.set(true);
          return this.api.post<Quote>('/pos/quote', { items: this.toItems(lines) }).pipe(
            catchError((err: unknown) => {
              this.quoteError.set(err);
              return of(null);
            }),
          );
        }),
      )
      .subscribe((q) => {
        this.quoting.set(false);
        if (q) this.quoteError.set(null);
        this.quote.set(q);
      });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  toItems(lines = this.lines()) {
    return lines.map((l) => ({
      productId: l.product.id,
      quantity: l.quantity,
      ...(l.discountRate && l.discountRate !== '0' ? { discount: { rate: l.discountRate, description: 'Discount' } } : {}),
    }));
  }

  add(product: Product): void {
    this.update((lines) => {
      const i = lines.findIndex((l) => l.product.id === product.id);
      if (i >= 0) {
        const next = [...lines];
        next[i] = { ...next[i]!, quantity: String(Number(next[i]!.quantity) + 1) };
        return next;
      }
      return [...lines, { product, quantity: '1', discountRate: '' }];
    });
  }

  setQuantity(index: number, quantity: string): void {
    if (!/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) return;
    this.update((lines) => lines.map((l, i) => (i === index ? { ...l, quantity } : l)));
  }

  step(index: number, delta: 1 | -1): void {
    const line = this.lines()[index];
    if (!line) return;
    const q = Number(line.quantity) + delta;
    if (q <= 0) this.remove(index);
    else this.setQuantity(index, String(q));
  }

  setDiscount(index: number, rate: string): void {
    if (rate !== '' && !/^\d{1,2}(\.\d{1,2})?$|^100$/.test(rate)) return;
    this.update((lines) => lines.map((l, i) => (i === index ? { ...l, discountRate: rate } : l)));
  }

  remove(index: number): void {
    this.update((lines) => lines.filter((_, i) => i !== index));
  }

  reset(): void {
    this.lines.set([]);
    this.quote.set(null);
    this.quoteError.set(null);
    this.idempotencyKey.set(newIdempotencyKey());
  }

  private update(fn: (lines: CartLine[]) => CartLine[]): void {
    this.lines.update(fn);
    // A changed cart is a different sale: it must not reuse a key from a previous attempt.
    this.idempotencyKey.set(newIdempotencyKey());
    this.changes.next(this.lines());
  }
}
