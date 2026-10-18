import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api/api.service';
import type { Branch } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';

@Component({
  selector: 'app-branches',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="row"><h1>{{ i18n.t('branches.title') }}</h1><span class="spacer"></span>
      @if (auth.can('branches:manage')) { <button mat-flat-button class="btn-primary" (click)="edit(null)">{{ i18n.t('branches.new') }}</button> }
    </header>
    @if (showForm()) {
      <form class="panel grid" [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field><mat-label>{{ i18n.t('devices.name') }}</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('branches.code') }}</mat-label><input matInput formControlName="etaBranchCode" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('company.activity') }}</mat-label><input matInput formControlName="activityCode" dir="ltr" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('branches.governate') }}</mat-label><input matInput formControlName="governate" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('branches.city') }}</mat-label><input matInput formControlName="regionCity" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('branches.street') }}</mat-label><input matInput formControlName="street" /></mat-form-field>
        <mat-form-field><mat-label>{{ i18n.t('branches.building') }}</mat-label><input matInput formControlName="buildingNumber" /></mat-form-field>
        <div class="wide row"><span class="spacer"></span>
          <button mat-button type="button" (click)="showForm.set(false)">{{ i18n.t('common.cancel') }}</button>
          <button mat-flat-button class="btn-primary" type="submit" [disabled]="form.invalid">{{ i18n.t('common.save') }}</button>
        </div>
      </form>
    }
    <section class="panel">
      <table class="data">
        <thead><tr><th>{{ i18n.t('devices.name') }}</th><th>{{ i18n.t('branches.code') }}</th><th>{{ i18n.t('branches.street') }}</th><th>{{ i18n.t('common.status') }}</th><th></th></tr></thead>
        <tbody>
          @for (b of branches(); track b.id) {
            <tr>
              <td>{{ b.name }}</td><td class="num" dir="ltr">{{ b.etaBranchCode }}</td>
              <td>{{ b.address['street'] }} {{ b.address['buildingNumber'] }}، {{ b.address['regionCity'] }}، {{ b.address['governate'] }}</td>
              <td>{{ b.isActive ? i18n.t('common.active') : i18n.t('common.inactive') }}</td>
              <td>@if (auth.can('branches:manage')) { <button mat-button (click)="edit(b)">{{ i18n.t('common.edit') }}</button> }</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `header h1 { margin: 0; } .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 4px 16px; margin-bottom: 16px; } .wide { grid-column: 1 / -1; }`,
})
export class BranchesPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly branches = signal<Branch[]>([]);
  readonly showForm = signal(false);
  private editingId: string | null = null;
  readonly form = inject(NonNullableFormBuilder).group({
    name: ['', Validators.required], etaBranchCode: ['', [Validators.required, Validators.maxLength(50)]], activityCode: [''],
    governate: ['', Validators.required], regionCity: ['', Validators.required], street: ['', Validators.required], buildingNumber: ['', Validators.required],
  });

  constructor() {
    this.load();
  }
  load(): void {
    this.api.get<Branch[]>('/branches').subscribe({ next: (b) => this.branches.set(b), error: (e) => this.notify.error(e) });
  }
  edit(b: Branch | null): void {
    this.editingId = b?.id ?? null;
    this.form.reset();
    if (b) this.form.patchValue({ name: b.name, etaBranchCode: b.etaBranchCode, activityCode: (b as unknown as { activityCode?: string }).activityCode ?? '', ...(b.address as Record<string, string>) });
    this.showForm.set(true);
  }
  save(): void {
    const v = this.form.getRawValue();
    const body = { name: v.name, etaBranchCode: v.etaBranchCode, activityCode: v.activityCode || null, address: { country: 'EG', governate: v.governate, regionCity: v.regionCity, street: v.street, buildingNumber: v.buildingNumber } };
    const req = this.editingId ? this.api.patch(`/branches/${this.editingId}`, body) : this.api.post('/branches', body);
    req.subscribe({ next: () => { this.showForm.set(false); this.load(); this.notify.success(this.i18n.t('company.saved')); }, error: (e) => this.notify.error(e) });
  }
}
