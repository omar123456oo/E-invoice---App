import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { Branch, PosDevice } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';

@Component({
  selector: 'app-devices',
  imports: [FormsModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row"><h1>{{ i18n.t('devices.title') }}</h1><span class="spacer"></span>
      @if (auth.can('pos:devices:manage')) { <button mat-flat-button class="btn-primary" (click)="showForm.set(!showForm())">{{ i18n.t('devices.new') }}</button> }
    </header>
    @if (showForm()) {
      <form class="panel grid" [formGroup]="form" (ngSubmit)="create()">
        <mat-form-field><mat-label>{{ i18n.t('common.branch') }}</mat-label>
          <mat-select formControlName="branchId">@for (b of branches(); track b.id) { <mat-option [value]="b.id">{{ b.name }}</mat-option> }</mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('devices.name') }}</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('devices.code') }}</mat-label><input matInput formControlName="code" maxlength="10" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('devices.serial') }}</mat-label><input matInput formControlName="serialNumber" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('devices.os') }}</mat-label><input matInput formControlName="osVersion" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('devices.framework') }}</mat-label><input matInput formControlName="modelFramework" dir="ltr" /></mat-form-field>
        <div class="wide row"><span class="spacer"></span><button mat-flat-button class="btn-primary" [disabled]="form.invalid">{{ i18n.t('common.save') }}</button></div>
      </form>
    }
    <section class="panel">
      <table class="data">
        <thead><tr><th>{{ i18n.t('devices.name') }}</th><th>{{ i18n.t('devices.serial') }}</th><th>{{ i18n.t('common.status') }}</th><th>{{ i18n.t('devices.credentials') }}</th><th class="end">{{ i18n.t('devices.chain') }}</th><th>{{ i18n.t('common.actions') }}</th></tr></thead>
        <tbody>
          @for (d of devices(); track d.id) {
            <tr>
              <td>{{ d.name }} <span class="muted num">({{ d.code }})</span></td><td class="num" dir="ltr">{{ d.serialNumber }}</td>
              <td>{{ i18n.t('devices.status.' + d.status) }}</td>
              <td>{{ d.credentialsConfigured ? i18n.t('devices.configured') : i18n.t('devices.notConfigured') }}</td>
              <td class="end num">{{ d.chain?.seq ?? 0 }}</td>
              <td class="row">
                @if (auth.can('pos:devices:manage')) {
                  @if (d.status !== 'ACTIVE') { <button mat-stroked-button (click)="setStatus(d, 'ACTIVE')">{{ i18n.t('devices.activate') }}</button> }
                  @else { <button mat-button (click)="setStatus(d, 'DEACTIVATED')">{{ i18n.t('devices.deactivate') }}</button> }
                }
                @if (auth.can('eta:manage')) { <button mat-button (click)="editing.set(d.id)">{{ i18n.t('devices.setCredentials') }}</button> }
              </td>
            </tr>
            @if (editing() === d.id) {
              <tr><td colspan="6">
                <form class="row" (ngSubmit)="saveCredentials(d)">
                  <mat-form-field><mat-label>{{ i18n.t('devices.clientId') }}</mat-label><input matInput name="cid" [(ngModel)]="cred.clientId" autocomplete="off" dir="ltr" /></mat-form-field>
                  <mat-form-field><mat-label>{{ i18n.t('devices.clientSecret') }}</mat-label><input matInput name="cs" type="password" [(ngModel)]="cred.clientSecret" autocomplete="new-password" dir="ltr" /></mat-form-field>
                  <mat-form-field><mat-label>{{ i18n.t('devices.psk') }}</mat-label><input matInput name="psk" type="password" [(ngModel)]="cred.presharedKey" autocomplete="new-password" dir="ltr" /></mat-form-field>
                  <button mat-flat-button class="btn-primary" type="submit">{{ i18n.t('common.save') }}</button>
                  <button mat-button type="button" (click)="editing.set(null)">{{ i18n.t('common.cancel') }}</button>
                  <p class="muted small full">{{ i18n.t('devices.credentialsNote') }}</p>
                </form>
              </td></tr>
            }
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `header h1 { margin: 0; } .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 4px 16px; margin-bottom: 16px; } .wide { grid-column: 1 / -1; } .small { font-size: 0.8rem; }`,
})
export class DevicesPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly devices = signal<PosDevice[]>([]);
  readonly branches = signal<Branch[]>([]);
  readonly showForm = signal(false);
  readonly editing = signal<string | null>(null);
  cred = { clientId: '', clientSecret: '', presharedKey: '' };
  readonly form = inject(NonNullableFormBuilder).group({
    branchId: ['', Validators.required], name: ['', Validators.required], code: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{1,10}$/)]],
    serialNumber: ['', Validators.required], osVersion: ['', Validators.required], modelFramework: ['', Validators.required],
  });

  constructor() {
    this.load();
    this.api.get<Branch[]>('/branches').subscribe({ next: (b) => this.branches.set(b), error: () => undefined });
  }

  load(): void {
    this.api.get<PosDevice[]>('/pos-devices').subscribe({ next: (d) => this.devices.set(d), error: (e) => this.notify.error(e) });
  }

  create(): void {
    this.api.post('/pos-devices', this.form.getRawValue()).subscribe({ next: () => { this.showForm.set(false); this.form.reset(); this.load(); }, error: (e) => this.notify.error(e) });
  }

  setStatus(d: PosDevice, status: PosDevice['status']): void {
    this.api.patch(`/pos-devices/${d.id}/status`, { status }).subscribe({ next: () => this.load(), error: (e) => this.notify.error(e) });
  }

  saveCredentials(d: PosDevice): void {
    this.api.put(`/pos-devices/${d.id}/eta-credentials`, this.cred).subscribe({
      next: () => {
        this.cred = { clientId: '', clientSecret: '', presharedKey: '' };
        this.editing.set(null);
        this.notify.success(this.i18n.t('company.saved'));
        this.load();
      },
      error: (e) => this.notify.error(e),
    });
  }
}
