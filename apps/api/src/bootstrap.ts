import { env } from './config/env.js';
import { logger } from './common/logging/logger.js';
import { EtaHttpClient } from './modules/eta/eta-http-client.js';
import { EtaIntegrationService, setEtaService } from './modules/eta/eta-integration.service.js';
import { ExternalSignerNotConfigured, NoSigner } from './modules/eta/signer.js';
import { SimulatedEtaApi } from './modules/eta/simulated-eta-api.js';
import { setMailer } from './modules/notifications/mailer.js';
import { SmtpMailer } from './modules/notifications/smtp-mailer.js';

/** Selects the mailer: SMTP when configured, otherwise the in-memory development mailer. */
export function configureMailer(): void {
  const cfg = env();
  if (cfg.SMTP_URL) setMailer(new SmtpMailer(cfg.SMTP_URL, cfg.MAIL_FROM));
}

/** Wires the ETA adapter according to configuration. */
export function configureEta(): EtaIntegrationService {
  const cfg = env();
  const api =
    cfg.ETA_TRANSPORT === 'simulated'
      ? new SimulatedEtaApi()
      : new EtaHttpClient({ environment: cfg.ETA_ENVIRONMENT, identityBaseUrl: cfg.ETA_IDENTITY_BASE_URL, apiBaseUrl: cfg.ETA_API_BASE_URL, timeoutMs: cfg.ETA_HTTP_TIMEOUT_MS });
  if (api.environment === 'simulated') logger.warn('ETA transport is SIMULATED: receipts are not sent to the Egyptian Tax Authority');
  const signer = cfg.ETA_SIGNING_MODE === 'none' ? new NoSigner() : new ExternalSignerNotConfigured();
  const svc = new EtaIntegrationService({ api, signer });
  setEtaService(svc);
  return svc;
}
