import { AppError } from '../../common/errors/app-error.js';

/**
 * Issuer signature for a receipt submission. ETA 02-submit-receipt describes
 * `signatures` as CAdES-BES values (Issuer required, Service Provider
 * optional) and states that signature validation "will not be deployed at
 * this point" pending an ETA decision. The exact signed content and the
 * signing device/certificate are external dependencies, so no signing
 * algorithm is invented here.
 */
export interface SubmissionSignature {
  signatureType: 'I' | 'S';
  value: string;
}

export interface Signer {
  readonly mode: 'none' | 'external';
  sign(receiptsJson: string[]): Promise<SubmissionSignature[] | null>;
}

/** Sends no signatures. Refused in production by configuration validation. */
export class NoSigner implements Signer {
  readonly mode = 'none' as const;
  async sign(): Promise<null> {
    return null;
  }
}

/** Placeholder for an HSM / e-seal integration. Fails loudly until implemented. */
export class ExternalSignerNotConfigured implements Signer {
  readonly mode = 'external' as const;
  async sign(): Promise<never> {
    throw new AppError(503, 'SIGNER_UNAVAILABLE', 'The issuer signing service is not configured');
  }
}

export function buildSubmissionBody(receiptsJson: string[], signatures: SubmissionSignature[] | null): string {
  const receipts = `"receipts":[${receiptsJson.join(',')}]`;
  return signatures ? `{${receipts},"signatures":${JSON.stringify(signatures)}}` : `{${receipts}}`;
}
