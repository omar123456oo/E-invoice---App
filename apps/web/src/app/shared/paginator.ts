import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../core/i18n/i18n.service';

@Component({
  selector: 'app-paginator',
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalPages() > 1) {
      <nav class="row pager" [attr.aria-label]="i18n.t('common.page')">
        <button mat-stroked-button [disabled]="page() <= 1" (click)="pageChange.emit(page() - 1)">{{ i18n.t('common.previous') }}</button>
        <span class="num muted">{{ i18n.t('common.page') }} {{ page() }} {{ i18n.t('common.of') }} {{ totalPages() }}</span>
        <button mat-stroked-button [disabled]="page() >= totalPages()" (click)="pageChange.emit(page() + 1)">{{ i18n.t('common.next') }}</button>
      </nav>
    }
  `,
  styles: `.pager { justify-content: center; margin-top: 12px; }`,
})
export class Paginator {
  readonly i18n = inject(I18nService);
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly pageChange = output<number>();
}
