/**
 * Optional OCR / field extraction for uploaded PDFs and images. Extracted
 * values are untrusted suggestions: every document goes through human review,
 * and totals are recalculated on the server. No provider is bundled.
 */
export interface ExtractedFields {
  documentNumber?: string;
  issueDate?: string;
  sellerName?: string;
  sellerTaxId?: string;
  total?: string;
}

export interface DocumentExtractor {
  readonly name: string;
  extract(data: Buffer, mime: string): Promise<{ fields: ExtractedFields; confidence: number }>;
}

export class NoExtractor implements DocumentExtractor {
  readonly name = 'none';
  async extract(): Promise<{ fields: ExtractedFields; confidence: number }> {
    return { fields: {}, confidence: 0 };
  }
}
