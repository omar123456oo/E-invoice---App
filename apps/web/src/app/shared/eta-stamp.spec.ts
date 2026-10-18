import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { EtaStamp } from './eta-stamp';

describe('EtaStamp', () => {
  it('shows a seal only for VALID receipts', () => {
    const f = TestBed.createComponent(EtaStamp);
    f.componentRef.setInput('status', 'VALID');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.stamp.ok svg')).not.toBeNull();
    f.componentRef.setInput('status', 'SUBMITTED');
    f.detectChanges();
    expect(f.nativeElement.querySelector('svg')).toBeNull();
    expect(f.nativeElement.querySelector('.stamp.pending')).not.toBeNull();
  });
});
