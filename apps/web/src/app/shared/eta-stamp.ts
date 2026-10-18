import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EtaStatus } from '../core/api/models';
import { I18nService } from '../core/i18n/i18n.service';

type Tone = 'ok' | 'pending' | 'bad' | 'verify' | 'none';
const TONE: Record<EtaStatus, Tone> = {
  VALID: 'ok', SUBMITTED: 'pending', QUEUED: 'pending', SUBMITTING: 'pending', UNKNOWN: 'verify', NOT_SUBMITTED: 'none',
  REJECTED: 'bad', INVALID: 'bad', FAILED: 'bad', CANCELLED: 'bad', SUPERSEDED: 'verify',
};

/**
 * The receipt's official-registration mark. Only VALID renders as a full seal;
 * every other state is visibly "not registered", so an internal receipt can
 * never be mistaken for an officially registered one.
 */
@Component({
  selector: 'app-eta-stamp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="stamp" [class]="'stamp ' + tone() + (large() ? ' large' : '')" role="status" [attr.aria-label]="label()">
      @if (tone() === 'ok') {
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      }
      {{ label() }}
    </span>
  `,
  styles: `
    .stamp { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-size: 0.82rem; font-weight: 600; white-space: nowrap; border: 1.5px solid currentColor; }
    .stamp svg { width: 14px; height: 14px; }
    .ok { color: var(--ok); background: #e7f4ec; }
    .pending { color: var(--pending); background: #fbf3e1; border-style: dashed; }
    .bad { color: var(--bad); background: #fdecea; }
    .verify { color: var(--verify); background: #eef2f3; border-style: dashed; }
    .none { color: var(--muted); background: transparent; border-style: dotted; }
    .large { padding: 10px 18px; border-width: 2.5px; border-radius: 14px; font-size: 1.05rem; transform: rotate(-2deg); letter-spacing: 0.01em; box-shadow: inset 0 0 0 3px #fff, inset 0 0 0 4.5px currentColor; }
    .large svg { width: 20px; height: 20px; }
  `,
})
export class EtaStamp {
  private readonly i18n = inject(I18nService);
  readonly status = input.required<EtaStatus>();
  readonly large = input(false);
  readonly tone = computed(() => TONE[this.status()]);
  readonly label = computed(() => this.i18n.t(`eta.status.${this.status()}`));
}
