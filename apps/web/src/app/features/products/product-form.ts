import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { Product, TaxRule } from '../../core/api/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';

const DECIMAL = /^\d{1,13}(\.\d{1,5})?$/;

@Component({
  selector: 'app-product-form',
  imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ id() ? i18n.t('common.edit') : i18n.t('products.new') }}</h1>
    <form class="panel grid" [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-form-field><mat-label>{{ i18n.t('products.kind') }}</mat-label>
        <mat-select formControlName="kind"><mat-option value="GOODS">{{ i18n.t('products.goods') }}</mat-option><mat-option value="SERVICE">{{ i18n.t('products.service') }}</mat-option></mat-select>
      </mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('products.internalCode') }}</mat-label><input matInput formControlName="internalCode" maxlength="50" dir="ltr" />
        @if (invalid('internalCode')) { <mat-error>{{ i18n.t('error.required') }}</mat-error> }</mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('products.barcode') }}</mat-label><input matInput formControlName="barcode" maxlength="64" dir="ltr" />
        @if (invalid('barcode')) { <mat-error>{{ i18n.t('error.invalid') }}</mat-error> }</mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('products.nameAr') }}</mat-label><input matInput formControlName="nameAr" maxlength="200" dir="rtl" />
        @if (invalid('nameAr')) { <mat-error>{{ i18n.t('error.required') }}</mat-error> }</mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('products.nameEn') }}</mat-label><input matInput formControlName="nameEn" maxlength="200" dir="ltr" /></mat-form-field>
      <mat-form-field class="wide"><mat-label>{{ i18n.t('products.description') }}</mat-label><input matInput formControlName="description" maxlength="500" />
        @if (invalid('description')) { <mat-error>{{ i18n.t('error.required') }}</mat-error> }</mat-form-field>
      <p class="wide note">{{ i18n.t('products.codeNote') }}</p>
      <mat-form-field><mat-label>{{ i18n.t('products.etaItemType') }}</mat-label>
        <mat-select formControlName="etaItemType"><mat-option value="EGS">EGS</mat-option><mat-option value="GS1">GS1</mat-option></mat-select>
      </mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('products.etaItemCode') }}</mat-label><input matInput formControlName="etaItemCode" maxlength="100" dir="ltr" />
        @if (invalid('etaItemCode')) { <mat-error>{{ i18n.t('error.required') }}</mat-error> }</mat-form-field>
      @if (id()) {
        <mat-form-field><mat-label>{{ i18n.t('products.etaCodeStatus') }}</mat-label>
          <mat-select formControlName="etaCodeStatus">@for (s of ['UNVERIFIED', 'APPROVED', 'REJECTED']; track s) { <mat-option [value]="s">{{ i18n.t('products.codeStatus.' + s) }}</mat-option> }</mat-select>
        </mat-form-field>
      }
      <mat-form-field><mat-label>{{ i18n.t('products.unitType') }}</mat-label><input matInput formControlName="unitType" maxlength="30" dir="ltr" /></mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('products.unitPrice') }}</mat-label><input matInput formControlName="unitPrice" inputmode="decimal" dir="ltr" />
        @if (invalid('unitPrice')) { <mat-error>{{ i18n.t('error.invalid') }}</mat-error> }</mat-form-field>
      <mat-form-field><mat-label>{{ i18n.t('products.taxCodes') }}</mat-label>
        <mat-select formControlName="taxCodes" multiple>@for (t of taxCodes(); track t.code) { <mat-option [value]="t.code">{{ t.code }} — {{ t.name }}</mat-option> }</mat-select>
        @if (invalid('taxCodes')) { <mat-error>{{ i18n.t('error.required') }}</mat-error> }
      </mat-form-field>
      <mat-checkbox formControlName="isActive">{{ i18n.t('common.active') }}</mat-checkbox>
      <div class="wide row"><span class="spacer"></span>
        <button mat-button type="button" (click)="back()">{{ i18n.t('common.cancel') }}</button>
        <button mat-flat-button class="btn-primary" type="submit" [disabled]="busy()">{{ i18n.t('common.save') }}</button>
      </div>
    </form>
  `,
  styles: `.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 4px 16px; max-width: 980px; } .wide { grid-column: 1 / -1; } .note { color: var(--pending); margin: 0 0 8px; }`,
})
export class ProductFormPage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  readonly id = input<string>();
  readonly busy = signal(false);
  readonly taxCodes = signal<TaxRule[]>([]);
  readonly form = inject(NonNullableFormBuilder).group({
    kind: ['GOODS' as 'GOODS' | 'SERVICE', Validators.required],
    internalCode: ['', [Validators.required, Validators.maxLength(50)]],
    barcode: ['', Validators.pattern(/^[0-9A-Za-z-]{4,64}$/)],
    nameAr: ['', Validators.required],
    nameEn: [''],
    description: ['', Validators.required],
    etaItemType: ['EGS' as 'EGS' | 'GS1', Validators.required],
    etaItemCode: ['', Validators.required],
    etaCodeStatus: ['UNVERIFIED' as Product['etaCodeStatus']],
    unitType: ['EA', Validators.required],
    unitPrice: ['', [Validators.required, Validators.pattern(DECIMAL)]],
    taxCodes: [[] as string[], Validators.required],
    isActive: [true],
  });

  constructor() {
    this.api.get<TaxRule[]>('/tax-configurations', { activeAt: new Date().toISOString() }).subscribe({ next: (t) => this.taxCodes.set(t), error: (e) => this.notify.error(e) });
    effect(() => {
      const id = this.id();
      if (!id || id === 'new') return;
      this.api.get<Product>(`/products/${id}`).subscribe({
        next: (p) => this.form.patchValue({ ...p, barcode: p.barcode ?? '', nameEn: p.nameEn ?? '' }),
        error: (e) => this.notify.error(e),
      });
    });
  }

  invalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const { etaCodeStatus, ...rest } = v;
    const body = { ...rest, barcode: v.barcode || null, nameEn: v.nameEn || null, ...(this.id() ? { etaCodeStatus } : {}) };
    this.busy.set(true);
    const req = this.id() ? this.api.patch(`/products/${this.id()}`, body) : this.api.post('/products', body);
    req.subscribe({
      next: () => {
        this.notify.success(this.i18n.t('company.saved'));
        this.back();
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }

  back(): void {
    void this.router.navigate(['/products']);
  }
}
