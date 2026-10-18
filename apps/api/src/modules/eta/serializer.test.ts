import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { num, parseEtaJson, serialize, toEtaJson, type EtaObject } from './serializer.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../test/fixtures/eta/${name}`, import.meta.url)), 'utf8');

describe('ETA serializer', () => {
  it('matches the official ETA golden serialization sample byte for byte', () => {
    const doc = parseEtaJson(fixture('one-doc.json'));
    expect(serialize(doc)).toBe(fixture('one-doc-serialized.txt'));
  });

  it('preserves numeric literals and repeats array names', () => {
    const doc: EtaObject = { code: '1', taxableItems: [{ amount: num('0.0') }, { amount: num('5') }] };
    expect(serialize(doc)).toBe('"CODE""1""TAXABLEITEMS""TAXABLEITEMS""AMOUNT""0.0""TAXABLEITEMS""AMOUNT""5"');
  });

  it('writes JSON with verbatim numeric literals and omits undefined properties', () => {
    const doc: EtaObject = { a: num('10.50'), b: 'x"y', c: undefined, d: [num('1.00')] };
    const json = toEtaJson(doc);
    expect(json).toBe('{"a":10.50,"b":"x\\"y","d":[1.00]}');
    expect(serialize(parseEtaJson(json))).toBe(serialize(doc));
  });

  it('round-trips the golden sample through toEtaJson without changing the serialization', () => {
    const doc = parseEtaJson(fixture('one-doc.json'));
    expect(serialize(parseEtaJson(toEtaJson(doc)))).toBe(fixture('one-doc-serialized.txt'));
  });
});
