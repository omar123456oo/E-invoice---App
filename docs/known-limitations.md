# Known limitations

| ID | Limitation | Impact | Plan |
|---|---|---|---|
| KL-01 | Issuer signature (CAdES-BES) not implemented; `ETA_SIGNING_MODE=external` fails closed | **Blocks production** | Needs signing device/certificate and ETA signing specification (compliance U-03) |
| KL-02 | No ETA preprod run has been performed; all ETA tests use the simulated ETA | Acceptance unknown | Run the checklist in eta-integration.md |
| KL-03 | Receipt correction with `referenceOldUUID` (96 h / 72 h windows) not implemented; REJECTED/INVALID receipts can only be investigated | Operator work | Phase 5 follow-up |
| KL-04 | Only VAT (T1) percentage and exempt treatments are supported; table tax, stamp tax, fees, contractor/beneficiary splits are refused | Some businesses cannot use it yet | Add treatments after tax-professional review |
| KL-05 | Prices are tax-exclusive; tax-inclusive shelf prices are not supported | Retail price entry | Design an inclusive-price mode with explicit rounding |
| KL-06 | EGP only in the UI (the document builder supports `exchangeRate`) | — | — |
| KL-07 | No alert for receipts approaching the 24-hour submission window | Late submission risk | Notification module |
| KL-08 | Notifications: only an in-memory mailer (refused in production); no SMTP, no email alerts for rejections/failed jobs/imports | Password reset unusable in production | Implement SMTP/provider mailer and alert jobs |
| KL-09 | No data-retention/archival jobs; retention periods unresolved (U-08) | Data grows | After legal review |
| KL-10 | Document upload/import centre (PDF/JPG/CSV/Excel, OCR, review queue) not implemented; product bulk import accepts JSON rows only | Module K missing | Next phase |
| KL-11 | Draft transactions are kept client-side (validated via quote); the server persists a transaction only when completed | No server-side parked carts | Add parked carts if required |
| KL-12 | ETA→ERP notification endpoints, search/package APIs not implemented | Polling only | After U-05 |
| KL-13 | QR code not printed (format unverified) | Receipt layout | Configure `ETA_RECEIPT_QR_TEMPLATE` once verified, add rendering |
| KL-14 | No customer management screen in the web app (API exists); no branch management screen (API exists) | Admin uses API | Add screens |
| KL-15 | Roles are fixed in code; no custom roles UI | — | — |
| KL-16 | Web app works offline only with server reachable; no offline POS queue | Network outage stops sales | Offline mode needs a separate ETA-compliant design |
| KL-17 | Docker images, compose file and CI workflow were not executed on the development machine | Unverified deployment | Run in CI |
| KL-18 | Dashboard and reports load up to 2000 product rows; no PDF reports; no Excel export (CSV only) | Large catalogues | Add server-side pagination for reports |
| KL-19 | Card payments are recorded from external terminal references; no payment-provider integration | Manual reference entry | Payment-provider adapter interface |
| KL-20 | Cash refunds paid from a shift are not limited by the cash available in the drawer | Possible negative expected cash | Add a check if required |
