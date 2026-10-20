import { afterEach, describe, expect, it, vi } from 'vitest';
import { startInProcessSweeper, stopInProcessSweeper, sweepAll } from '../src/jobs/sweeper.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { useTestApp } from './helpers.js';

useTestApp();

afterEach(() => {
  stopInProcessSweeper();
  vi.restoreAllMocks();
});

describe('in-process sweeper', () => {
  it('survives a database error during a sweep instead of leaving an unhandled rejection', async () => {
    vi.spyOn(TenantModel, 'find').mockImplementation(() => {
      throw new Error('simulated: connection lost');
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(sweepAll()).resolves.toBeUndefined();

      startInProcessSweeper(20);
      await new Promise((r) => setTimeout(r, 120));
      stopInProcessSweeper();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
