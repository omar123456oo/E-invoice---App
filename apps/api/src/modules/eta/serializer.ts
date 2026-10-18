/**
 * ETA document serialization ("document-serialization-approach", ETA SDK).
 *
 *  - Property names are upper-cased (culture invariant) and double-quoted.
 *  - Simple values are double-quoted and taken exactly as written in the
 *    input document (so 10.50 stays "10.50", never "10.5").
 *  - Every array element is preceded by the array property name, and the
 *    name is also written once before the elements.
 *  - Properties are processed in document order.
 *
 * Because the hash depends on the literal text of numbers, numbers are
 * modelled as EtaNumber (holding the literal) instead of JS numbers, and the
 * JSON body that is sent to ETA is written by `toEtaJson` from the same
 * tree. What we hash and what we send therefore cannot diverge.
 */
export class EtaNumber {
  constructor(public readonly literal: string) {
    if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(literal)) throw new Error(`Invalid numeric literal: ${literal}`);
  }
}

export type EtaValue = string | boolean | null | EtaNumber | EtaValue[] | EtaObject;
export interface EtaObject {
  [key: string]: EtaValue | undefined;
}

export const num = (literal: string): EtaNumber => new EtaNumber(literal);

function scalarText(v: string | boolean | null | EtaNumber): string {
  if (v instanceof EtaNumber) return v.literal;
  if (v === null) return '';
  return String(v);
}

export function serialize(value: EtaValue): string {
  if (value === null || typeof value !== 'object' || value instanceof EtaNumber) {
    return `"${scalarText(value as string | boolean | null | EtaNumber)}"`;
  }
  if (Array.isArray(value)) throw new Error('A bare array cannot be serialized; arrays must be properties');
  let out = '';
  for (const [name, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const upper = `"${name.toUpperCase()}"`;
    if (Array.isArray(v)) {
      out += upper;
      for (const el of v) out += upper + serialize(el);
    } else {
      out += upper + serialize(v);
    }
  }
  return out;
}

/** Writes the tree as JSON, emitting EtaNumber literals verbatim. Undefined properties are omitted. */
export function toEtaJson(value: EtaValue | undefined): string {
  if (value === undefined) return 'null';
  if (value instanceof EtaNumber) return value.literal;
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => toEtaJson(v)).join(',')}]`;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value)) if (v !== undefined) parts.push(`${JSON.stringify(k)}:${toEtaJson(v)}`);
  return `{${parts.join(',')}}`;
}

/**
 * Minimal JSON parser that preserves numeric literals as EtaNumber. Used to
 * re-serialize stored documents and in tests against ETA golden files.
 */
export function parseEtaJson(text: string): EtaValue {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const fail = (msg: string): never => {
    throw new Error(`Invalid JSON at ${i}: ${msg}`);
  };
  const parseValue = (): EtaValue => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const obj: EtaObject = {};
      ws();
      if (text[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        const key = parseString();
        ws();
        if (text[i++] !== ':') fail('expected :');
        obj[key] = parseValue();
        ws();
        const sep = text[i++];
        if (sep === '}') return obj;
        if (sep !== ',') fail('expected , or }');
      }
    }
    if (c === '[') {
      i++;
      const arr: EtaValue[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue());
        ws();
        const sep = text[i++];
        if (sep === ']') return arr;
        if (sep !== ',') fail('expected , or ]');
      }
    }
    if (c === '"') return parseString();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) return fail('unexpected token');
    i += m[0].length;
    return new EtaNumber(m[0]);
  };
  const parseString = (): string => {
    if (text[i] !== '"') fail('expected string');
    let j = i + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    const raw = text.slice(i, j + 1);
    i = j + 1;
    return JSON.parse(raw) as string;
  };
  const v = parseValue();
  ws();
  if (i !== text.length) fail('trailing characters');
  return v;
}
