import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { TaxRule } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { LocalDatePipe } from '../../shared/money.pipe';

@Component({
  selector: 'app-tax-rules',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row"><h1>{{ i18n.t('tax.title') }}</h1><span class="spacer"></span>
      @if (auth.can('tax:manage')) { <button mat-flat-button class="btn-primary" (click)="showForm.set(!showForm())">{{ i18n.t('tax.new') }}</button> }
    </header>
    <p class="muted">{{ i18n.t('tax.note') }}</p>
    @if (showForm()) {
      <form class="panel grid" [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field><mat-label>{{ i18n.t('tax.code') }}</mat-label><input matInput formControlName="code" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('users.name') }}</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('tax.type') }}</mat-label><input matInput formControlName="etaTaxType" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('tax.subType') }}</mat-label><input matInput formControlName="etaSubType" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('tax.treatment') }}</mat-label>
          <mat-select formControlName="treatment"><mat-option value="PERCENTAGE">{{ i18n.t('tax.PERCENTAGE') }}</mat-option><mat-option value="EXEMPT">{{ i18n.t('tax.EXEMPT') }}</mat-option></mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('tax.rate') }}</mat-label><input matInput formControlName="rate" inputmode="decimal" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('tax.effectiveFrom') }}</mat-label><input matInput type="datetime-local" formControlName="effectiveFrom" /></mat-form-field>
        <mat-form-field class="wide"><mat-label>{{ i18n.t('tax.source') }}</mat-label><input matInput formControlName="source" maxlength="500" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('tax.verifiedBy') }}</mat-label><input matInput formControlName="verifiedBy" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('tax.verifiedAt') }}</mat-label><input matInput type="date" formControlName="verifiedAt" /></mat-form-field>
        <div class="wide row"><span class="spacer"></span><button mat-flat-button class="btn-primary" [disabled]="form.invalid">{{ i18n.t('common.save') }}</button></div>
      </form>
    }
    <section class="panel">
      <table class="data">
        <thead><tr><th>{{ i18n.t('tax.code') }}</th><th>{{ i18n.t('tax.version') }}</th><th>{{ i18n.t('tax.type') }}</th><th>{{ i18n.t('tax.treatment') }}</th><th class="end">{{ i18n.t('tax.rate') }}</th><th>{{ i18n.t('tax.effectiveFrom') }}</th><th>{{ i18n.t('tax.effectiveTo') }}</th><th>{{ i18n.t('tax.source') }}</th></tr></thead>
        <tbody>
          @for (r of rules(); track r.id) {
            <tr [class.muted]="r.effectiveTo">
              <td class="num">{{ r.code }}</td><td class="num">{{ r.version }}</td><td dir="ltr">{{ r.etaTaxType }} / {{ r.etaSubType }}</td>
              <td>{{ i18n.t('tax.' + r.treatment) }}</td><td class="end num">{{ r.rate }}</td>
              <td>{{ r.effectiveFrom | localDate }}</td><td>{{ r.effectiveTo | localDate }}</td>
              <td class="small">{{ r.verification.source }} ({{ r.verification.verifiedBy }})</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `header h1 { margin: 0; } .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 4px 16px; margin-bottom: 16px; } .wide { grid-column: 1 / -1; } .small { font-size: 0.8rem; }`,
})
export class TaxRulesPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly rules = signal<TaxRule[]>([]);
  readonly showForm = signal(false);
  readonly form = inject(NonNullableFormBuilder).group({
    code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9_]{2,40}$/)]],
    name: ['', Validators.required],
    etaTaxType: ['T1', Validators.required],
    etaSubType: ['', Validators.required],
    treatment: ['PERCENTAGE' as 'PERCENTAGE' | 'EXEMPT'],
    rate: ['', [Validators.required, Validators.pattern(/^\d{1,3}(\.\d{1,4})?$/)]],
    effectiveFrom: ['', Validators.required],
    source: ['', [Validators.required, Validators.minLength(5)]],
    verifiedBy: ['', Validators.required],
    verifiedAt: ['', Validators.required],
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.api.get<TaxRule[]>('/tax-configurations').subscribe({ next: (r) => this.rules.set(r), error: (e) => this.notify.error(e) });
  }

  save(): void {
    const v = this.form.getRawValue();
    const body = {
      code: v.code, name: v.name, etaTaxType: v.etaTaxType, etaSubType: v.etaSubType, treatment: v.treatment, rate: v.rate,
      effectiveFrom: new Date(v.effectiveFrom).toISOString(),
      verification: { source: v.source, verifiedBy: v.verifiedBy, verifiedAt: new Date(v.verifiedAt).toISOString() },
    };
    this.api.post('/tax-configurations', body).subscribe({
      next: () => {
        this.showForm.set(false);
        this.form.reset();
        this.load();
      },
      error: (e) => this.notify.error(e),
    });
  }
}
