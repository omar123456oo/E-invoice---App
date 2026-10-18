import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api/api.service';

/** Unread notification count for the side menu, refreshed every minute while signed in. */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly api = inject(ApiService);
  readonly unread = signal(0);
  private timer: ReturnType<typeof setInterval> | undefined;

  start(destroyRef: DestroyRef): void {
    this.refresh();
    this.timer ??= setInterval(() => this.refresh(), 60_000);
    destroyRef.onDestroy(() => {
      clearInterval(this.timer);
      this.timer = undefined;
    });
  }

  refresh(): void {
    this.api.get<{ unread: number }>('/notifications/unread-count').subscribe({ next: (r) => this.unread.set(r.unread), error: () => undefined });
  }
}
