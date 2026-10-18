import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api/api.service';
import type { Page, Product } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Paginator } from '../../shared/paginator';

@Component({
  selector: 'app-product-list',
  imports: [FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MoneyPipe, Paginator, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row">
      <h1>{{ i18n.t('products.title') }}</h1><span class="spacer"></span>
      @if (auth.can('products:manage')) { <a mat-flat-button class="btn-primary" routerLink="/products/new">{{ i18n.t('products.new') }}</a> }
    </header>
    <form class="row" (ngSubmit)="load(1)">
      <mat-form-field class="q"><mat-label>{{ i18n.t('common.search') }}</mat-label><input matInput name="q" [(ngModel)]="q" /></mat-form-field>
      <button mat-stroked-button type="submit">{{ i18n.t('common.search') }}</button>
    </form>
    <section class="panel">
      @if (page(); as p) {
        @if (p.items.length === 0) { <app-empty-state [message]="i18n.t('common.noResults')" /> } @else {
          <table class="data">
            <thead><tr><th>{{ i18n.t('products.internalCode') }}</th><th>{{ i18n.t('products.nameAr') }}</th><th>{{ i18n.t('products.etaItemCode') }}</th><th>{{ i18n.t('products.taxCodes') }}</th><th class="end">{{ i18n.t('products.unitPrice') }}</th><th>{{ i18n.t('common.status') }}</th></tr></thead>
            <tbody>
              @for (x of p.items; track x.id) {
                <tr [class.clickable]="auth.can('products:manage')" (click)="open(x)">
                  <td class="num">{{ x.internalCode }}</td>
                  <td>{{ x.nameAr }}@if (x.nameEn) { <div class="muted small">{{ x.nameEn }}</div> }</td>
                  <td class="num" dir="ltr">{{ x.etaItemType }} {{ x.etaItemCode }}<div class="small" [class.error-text]="x.etaCodeStatus === 'REJECTED'" [class.muted]="x.etaCodeStatus !== 'REJECTED'">{{ i18n.t('products.codeStatus.' + x.etaCodeStatus) }}</div></td>
                  <td>{{ x.taxCodes.join(', ') }}</td>
                  <td class="end money">{{ x.unitPrice | money }}</td>
                  <td>{{ x.isActive ? i18n.t('common.active') : i18n.t('common.inactive') }}</td>
                </tr>
              }
            </tbody>
          </table>
          <app-paginator [page]="p.page" [totalPages]="p.totalPages" (pageChange)="load($event)" />
        }
      } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
    </section>
  `,
  styles: `header h1 { margin: 0; } .q { width: 320px; } .small { font-size: 0.8rem; }`,
})
export class ProductListPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  readonly page = signal<Page<Product> | null>(null);
  q = '';
  constructor() {
    this.load(1);
  }
  load(page: number): void {
    this.api.get<Page<Product>>('/products', { page, pageSize: 25, q: this.q.trim() }).subscribe({ next: (p) => this.page.set(p), error: (e) => this.notify.error(e) });
  }
  open(p: Product): void {
    if (this.auth.can('products:manage')) void this.router.navigate(['/products', p.id]);
  }
}
