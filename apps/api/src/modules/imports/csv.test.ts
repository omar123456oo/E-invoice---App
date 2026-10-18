import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('keeps text verbatim, handles quotes, CRLF, BOM and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n"x, y",00123\n\n"say ""hi""",10.50')).toEqual([['a', 'b'], ['x, y', '00123'], ['say "hi"', '10.50']]);
  });
  it('rejects unterminated quotes', () => {
    expect(() => parseCsv('"abc')).toThrow();
  });
});
