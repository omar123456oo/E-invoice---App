import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api/api.service';
import type { ImportJob, Page } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { LocalDatePipe } from '../../shared/money.pipe';
import { Paginator } from '../../shared/paginator';

const PURPOSES = ['PRODUCT_IMPORT', 'SUPPLIER_INVOICE', 'EXISTING_OFFICIAL_RECEIPT', 'EXTERNAL_DOCUMENT'];

@Component({
  selector: 'app-import-list',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule, LocalDatePipe, Paginator, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ i18n.t('imports.title') }}</h1>
    @if (auth.can('imports:manage')) {
      <section class="panel stack upload">
        <h2>{{ i18n.t('imports.upload') }}</h2>
        <div class="row">
          <mat-form-field><mat-label>{{ i18n.t('imports.purpose') }}</mat-label>
            <mat-select [(ngModel)]="purpose">@for (p of purposes; track p) { <mat-option [value]="p">{{ i18n.t('imports.purpose.' + p) }}</mat-option> }</mat-select>
          </mat-form-field>
          <label class="file">
            <span>{{ file()?.name ?? i18n.t('imports.file') }}</span>
            <input type="file" [accept]="purpose === 'PRODUCT_IMPORT' ? '.csv,.xlsx' : '.pdf,.jpg,.jpeg,.png'" (change)="pick($event)" />
          </label>
          <button mat-flat-button class="btn-primary" [disabled]="!file() || busy()" (click)="upload()">{{ i18n.t('imports.upload') }}</button>
          <span class="spacer"></span>
          <button mat-button (click)="template()">{{ i18n.t('imports.template') }}</button>
        </div>
      </section>
    }
    <section class="panel">
      @if (page(); as p) {
        @if (p.items.length === 0) { <app-empty-state [message]="i18n.t('common.noResults')" /> } @else {
          <table class="data">
            <thead><tr><th>{{ i18n.t('common.date') }}</th><th>{{ i18n.t('imports.file') }}</th><th>{{ i18n.t('imports.purpose') }}</th><th>{{ i18n.t('common.status') }}</th><th class="end">{{ i18n.t('imports.rows') }}</th><th>{{ i18n.t('imports.scan') }}</th></tr></thead>
            <tbody>
              @for (j of p.items; track j.id) {
                <tr class="clickable" tabindex="0" (click)="open(j)" (keydown.enter)="open(j)">
                  <td>{{ j.createdAt | localDate }}</td><td>{{ j.upload?.originalName }}</td><td>{{ i18n.t('imports.purpose.' + j.purpose) }}</td>
                  <td [class.error-text]="j.status === 'FAILED'">{{ i18n.t('imports.status.' + j.status) }}</td>
                  <td class="end num">@if (j.kind === 'PRODUCTS') { {{ j.counts.valid }} / {{ j.counts.total }} }</td>
                  <td class="small">@if (j.upload; as u) { @if (u.scan) { {{ i18n.t('scan.' + u.scan) }} } }</td>
                </tr>
              }
            </tbody>
          </table>
          <app-paginator [page]="p.page" [totalPages]="p.totalPages" (pageChange)="load($event)" />
        }
      } @else { <p class="muted">{{ i18n.t('common.loading') }}</p> }
    </section>
  `,
  styles: `
    .upload { margin-bottom: 20px; }
    .file { display: inline-flex; align-items: center; gap: 8px; border: 1.5px dashed var(--line); border-radius: var(--radius-s); padding: 12px 16px; cursor: pointer; min-width: 220px; }
    .file:focus-within { outline: 3px solid var(--brass); }
    .file input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .small { font-size: 0.8rem; }
  `,
})
export class ImportListPage {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  readonly purposes = PURPOSES;
  readonly page = signal<Page<ImportJob> | null>(null);
  readonly file = signal<File | null>(null);
  readonly busy = signal(false);
  purpose = 'PRODUCT_IMPORT';

  constructor() {
    this.load(1);
  }
  load(page: number): void {
    this.api.get<Page<ImportJob>>('/imports', { page, pageSize: 25 }).subscribe({ next: (p) => this.page.set(p), error: (e) => this.notify.error(e) });
  }
  pick(e: Event): void {
    this.file.set((e.target as HTMLInputElement).files?.[0] ?? null);
  }
  upload(): void {
    const f = this.file();
    if (!f) return;
    const form = new FormData();
    form.append('purpose', this.purpose);
    form.append('file', f, f.name);
    this.busy.set(true);
    this.api.upload<{ duplicate: boolean; job: ImportJob | null }>('/imports/uploads', form).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.file.set(null);
        if (r.duplicate) this.notify.warn(this.i18n.t('imports.duplicate'));
        if (r.job) void this.router.navigate(['/imports', r.job.id]);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
  template(): void {
    this.api.download('/imports/templates/products.csv').subscribe({
      next: (blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'products-template.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      },
      error: (e) => this.notify.error(e),
    });
  }
  open(j: ImportJob): void {
    void this.router.navigate(['/imports', j.id]);
  }
}
