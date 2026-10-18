import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, ETA_STATUSES, mapOfficialDocumentStatus, OFFICIALLY_REGISTERED, TRANSITIONS } from './eta-status.js';

describe('ETA status state machine', () => {
  it('defines transitions for every status, targeting only known statuses', () => {
    for (const s of ETA_STATUSES) for (const t of TRANSITIONS[s]) expect(ETA_STATUSES).toContain(t);
  });

  it('never allows an unknown outcome to be resent without reconciliation passing through QUEUED', () => {
    expect(canTransition('UNKNOWN', 'SUBMITTING')).toBe(false);
    expect(canTransition('UNKNOWN', 'QUEUED')).toBe(true);
  });

  it('only reaches VALID from submitted or reconciled states', () => {
    const sources = ETA_STATUSES.filter((s) => canTransition(s, 'VALID'));
    expect(sources.sort()).toEqual(['SUBMITTED', 'UNKNOWN']);
  });

  it('treats cancelled and superseded as terminal', () => {
    expect(TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(TRANSITIONS.SUPERSEDED).toHaveLength(0);
  });

  it('rejects invalid transitions', () => {
    expect(() => assertTransition('NOT_SUBMITTED', 'VALID')).toThrow(/Invalid ETA status transition/);
    expect(() => assertTransition('VALID', 'QUEUED')).toThrow();
  });

  it('maps official statuses case-insensitively and ignores unknown values', () => {
    expect(mapOfficialDocumentStatus('Valid')).toBe('VALID');
    expect(mapOfficialDocumentStatus('invalid')).toBe('INVALID');
    expect(mapOfficialDocumentStatus('Cancelled')).toBe('CANCELLED');
    expect(mapOfficialDocumentStatus('InProgress')).toBe('IN_PROGRESS');
    expect(mapOfficialDocumentStatus('SomethingNew')).toBeNull();
  });

  it('considers only VALID as officially registered', () => {
    expect([...OFFICIALLY_REGISTERED]).toEqual(['VALID']);
  });
});
