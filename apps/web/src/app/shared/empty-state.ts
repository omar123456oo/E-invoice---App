import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="empty"><p>{{ message() }}</p><ng-content /></div>`,
  styles: `.empty { padding: 32px 16px; text-align: center; color: var(--muted); } .empty p { margin: 0 0 12px; }`,
})
export class EmptyState {
  readonly message = input.required<string>();
}
