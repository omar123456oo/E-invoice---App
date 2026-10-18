import { fileTypeFromBuffer } from 'file-type';

export type AllowedKind = 'pdf' | 'jpg' | 'png' | 'csv' | 'xlsx';
export const MIME: Record<AllowedKind, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Identifies the file by its content (magic bytes), not by its name or the
 * client-declared MIME type. CSV has no signature, so it must be valid UTF-8
 * text without NUL bytes and carry a .csv name.
 */
export async function detectKind(data: Buffer, originalName: string): Promise<AllowedKind | null> {
  const ft = await fileTypeFromBuffer(data);
  if (ft) {
    if (ft.mime === MIME.pdf) return 'pdf';
    if (ft.mime === MIME.jpg) return 'jpg';
    if (ft.mime === MIME.png) return 'png';
    if (ft.ext === 'xlsx') return 'xlsx';
    return null;
  }
  if (/\.csv$/i.test(originalName) && !data.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data);
      return 'csv';
    } catch {
      return null;
    }
  }
  return null;
}
