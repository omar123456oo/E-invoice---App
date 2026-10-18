import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { Company, PaymentMethod } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';

const METHODS: PaymentMethod[] = ['CASH', 'CARD', 'BANK_TRANSFER', 'WALLET', 'VOUCHER', 'GIFT_CARD', 'POINTS', 'OTHER'];
const STAGES = ['NOT_STARTED', 'IN_PROGRESS', 'PREPROD_TESTING', 'PREPROD_PASSED', 'PRODUCTION_AUTHORIZED'];

@Component({
  selector: 'app-company',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ i18n.t('company.title') }}</h1>
    @if (c(); as c) {
      <form class="stack" (ngSubmit)="save()">
        <section class="panel grid">
          <mat-form-field><mat-label>{{ i18n.t('company.legalName') }}</mat-label><input matInput name="ln" [(ngModel)]="c.legalName" [disabled]="!editable" /></mat-form-field>
          <mat-form-field><mat-label>{{ i18n.t('company.tradeName') }}</mat-label><input matInput name="tn" [(ngModel)]="c.tradeName" [disabled]="!editable" /></mat-form-field>
          <mat-form-field><mat-label>{{ i18n.t('company.rin') }}</mat-label><input matInput name="rin" [value]="c.taxRegistrationNumber" disabled dir="ltr" /></mat-form-field>
          <mat-form-field><mat-label>{{ i18n.t('company.activity') }}</mat-label><input matInput name="ac" [(ngModel)]="c.activityCode" [disabled]="!editable" dir="ltr" /></mat-form-field>
        </section>
        <section class="panel grid">
          <mat-form-field class="wide"><mat-label>{{ i18n.t('company.paymentMethods') }}</mat-label>
            <mat-select name="pm" multiple [(ngModel)]="c.settings.enabledPaymentMethods" [disabled]="!editable">@for (m of methods; track m) { <mat-option [value]="m">{{ i18n.t('pay.' + m) }}</mat-option> }</mat-select>
          </mat-form-field>
          <mat-form-field><mat-label>{{ i18n.t('company.buyerThreshold') }}</mat-label><input matInput name="bt" [(ngModel)]="c.settings.buyerIdentityThreshold" [disabled]="!editable" dir="ltr" /></mat-form-field>
          <mat-form-field><mat-label>{{ i18n.t('company.returnWindow') }}</mat-label><input matInput name="rw" type="number" min="0" max="540" [(ngModel)]="c.settings.returnWindowDays" [disabled]="!editable" /></mat-form-field>
          <mat-form-field><mat-label>{{ i18n.t('company.returnApprovalAmount') }}</mat-label><input matInput name="ra" [(ngModel)]="c.settings.returnApprovalAmount" [disabled]="!editable" dir="ltr" /></mat-form-field>
          <mat-form-field><mat-label>{{ i18n.t('company.maxDiscount') }}</mat-label><input matInput name="md" [(ngModel)]="c.settings.maxCashierDiscountPercent" [disabled]="!editable" dir="ltr" /></mat-form-field>
          <mat-checkbox class="wide" name="ea" [(ngModel)]="c.settings.emailAlerts" [disabled]="!editable">{{ i18n.t('company.emailAlerts') }}</mat-checkbox>
        </section>
        <section class="panel stack">
          <h2>{{ i18n.t('company.eta') }}</h2>
          <mat-form-field><mat-label>{{ i18n.t('company.onboarding') }}</mat-label>
            <mat-select name="ob" [(ngModel)]="c.eta.onboardingStatus" [disabled]="!editable">@for (s of stages; track s) { <mat-option [value]="s">{{ s }}</mat-option> }</mat-select>
          </mat-form-field>
          <mat-checkbox name="b2c" [(ngModel)]="c.eta.b2cTagConfirmed" [disabled]="!editable">{{ i18n.t('company.b2c') }}</mat-checkbox>
          <mat-checkbox name="sub" [(ngModel)]="c.eta.submissionEnabled" [disabled]="!editable || !c.eta.b2cTagConfirmed">{{ i18n.t('company.submission') }}</mat-checkbox>
        </section>
        @if (editable) { <div class="row"><span class="spacer"></span><button mat-flat-button class="btn-primary" type="submit">{{ i18n.t('common.save') }}</button></div> }
      </form>
    } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
  `,
  styles: `.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 4px 16px; } .wide { grid-column: 1 / -1; }`,
})
export class CompanyPage {
  readonly i18n = inject(I18nService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly editable = inject(AuthService).can('company:manage');
  readonly c = signal<Company | null>(null);
  readonly methods = METHODS;
  readonly stages = STAGES;

  constructor() {
    this.api.get<Company>('/company').subscribe({ next: (c) => this.c.set(structuredClone(c)), error: (e) => this.notify.error(e) });
  }

  save(): void {
    const c = this.c();
    if (!c) return;
    const body = {
      legalName: c.legalName, tradeName: c.tradeName, activityCode: c.activityCode,
      settings: {
        enabledPaymentMethods: c.settings.enabledPaymentMethods, buyerIdentityThreshold: String(c.settings.buyerIdentityThreshold),
        returnWindowDays: Number(c.settings.returnWindowDays), returnApprovalAmount: String(c.settings.returnApprovalAmount),
        maxCashierDiscountPercent: String(c.settings.maxCashierDiscountPercent), emailAlerts: Boolean(c.settings.emailAlerts),
      },
      eta: { onboardingStatus: c.eta.onboardingStatus, b2cTagConfirmed: c.eta.b2cTagConfirmed, submissionEnabled: c.eta.submissionEnabled },
    };
    this.api.patch<Company>('/company', body).subscribe({ next: (x) => { this.c.set(structuredClone(x)); this.notify.success(this.i18n.t('company.saved')); }, error: (e) => this.notify.error(e) });
  }
}
