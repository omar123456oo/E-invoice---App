# Known limitations

| ID | Limitation | Impact | Plan |
|---|---|---|---|
| KL-01 | Issuer signature (CAdES-BES) not implemented; `ETA_SIGNING_MODE=external` fails closed | **Blocks production** | Needs signing device/certificate and ETA signing specification (compliance U-03) |
| KL-02 | No ETA preprod run has been performed; all ETA tests use the simulated ETA | Acceptance unknown | Run the checklist in eta-integration.md with real preprod credentials |
| KL-04 | Only VAT (T1) percentage and exempt treatments are supported; table tax, stamp tax, fees, contractor/beneficiary splits are refused | Some businesses cannot use it yet | Add treatments after tax-professional review |
| KL-05 | Prices are tax-exclusive; tax-inclusive shelf prices are not supported | Retail price entry | Design an inclusive-price mode with explicit rounding |
| KL-06 | EGP only in the UI (the document builder supports `exchangeRate`) | — | — |
| KL-09 | No data-retention/archival jobs; retention periods unresolved (U-08) | Data grows | After legal review |
| KL-10 | No OCR provider is bundled; uploaded documents are reviewed manually (an extractor interface exists) | Manual data entry | Plug in an OCR service behind `DocumentExtractor` |
| KL-11 | Draft carts are kept client-side (validated via quote); no server-side parked carts | — | Add if required |
| KL-12 | ETA→ERP notification endpoints and search/package APIs not implemented | Polling only | After U-05 |
| KL-13 | QR code not printed (format unverified) | Receipt layout | Configure `ETA_RECEIPT_QR_TEMPLATE` once verified, add rendering |
| KL-15 | Roles are fixed in code; no custom roles UI | — | — |
| KL-16 | No offline POS mode | Network outage stops sales | Offline mode needs a separate ETA-compliant design |
| KL-17 | Docker images, compose file and the CI workflow were not executed on the development machine (no Docker) | Unverified deployment | Run in CI |
| KL-18 | No PDF reports (screen, CSV and Excel only); report endpoints return up to 50,000 rows | Very large exports | Add PDF and streamed exports if needed |
| KL-19 | Card payments are recorded from external terminal references; no payment-provider integration | Manual reference entry | Payment-provider adapter |
| KL-21 | Server validation messages (e.g. row errors) are in English; UI labels are bilingual | Arabic users see some English messages | Translate error codes in the UI |
| KL-22 | Upload storage is local disk; multiple API hosts need a shared volume or an object-storage implementation of `FileStorage` | Horizontal scaling | S3/Azure adapter |
| KL-24 | On Vercel there is no worker: jobs run after the response, plus a cron sweep (daily on the Hobby plan) and a manual "run now" button | Receipts may wait for the next sweep if a background run fails | Use Pro cron every 10 min, or a server deployment with the worker |
| KL-23 | Without ClamAV configured uploads are not malware-scanned (shown as "Not scanned") | Risk from uploaded files | Configure `CLAMAV_ADDRESS` in production |

Resolved since the first release: receipt corrections (KL-03), 24-hour window
alert (KL-07), SMTP mailer and alerts (KL-08), import centre (KL-10, except OCR),
customer and branch screens (KL-14), Excel export (KL-18, part), refund limited
to drawer cash (KL-20).
