# ETA integration

All facts here were taken from the official SDK on 2026-10-18; see
[compliance-matrix.md](compliance-matrix.md) for sources and open questions.

## Components (`apps/api/src/modules/eta`)

| File | Role |
|---|---|
| serializer.ts | ETA canonical serialization; literal-preserving JSON writer and parser |
| receipt-document.ts | Builds receipt / return receipt v1.2 documents; computes the UUID |
| eta-api.ts | Typed contract of the ETA endpoints used, with discriminated outcomes |
| eta-http-client.ts | Real HTTP implementation (timeouts, no secret logging) |
| token-manager.ts | Per-device token cache, single-flight refresh, early renewal |
| signer.ts | Issuer-signature interface; `NoSigner` (non-production) and a fail-closed external placeholder |
| eta-integration.service.ts | Submission, polling, reconciliation, operator requeue |
| simulated-eta-api.ts | **SIMULATED ETA** test double; refused in production |
| eta-submission.model.ts | Log of every submission attempt |

## Configuration

| Variable | Purpose |
|---|---|
| `ETA_TRANSPORT` | `http` (real) or `simulated` (test double; forbidden when `NODE_ENV=production`) |
| `ETA_ENVIRONMENT` | `preprod` or `production` (production only allowed with `NODE_ENV=production`) |
| `ETA_IDENTITY_BASE_URL`, `ETA_API_BASE_URL` | Official base URLs for the selected environment |
| `ETA_HTTP_TIMEOUT_MS` | Request timeout |
| `ETA_SIGNING_MODE` | `none` (refused with the production environment) or `external` (not yet implemented; fails closed) |
| `ETA_RECEIPT_QR_TEMPLATE` | Optional QR content template; leave empty until the official format is verified |

Per-device credentials (`client_id`, `client_secret`, pre-shared key) are entered on
the POS devices page, stored AES-256-GCM encrypted with `DATA_ENCRYPTION_KEY`, are
write-only through the API and never logged. Tokens live only in worker memory.

Per-company switches: `eta.b2cTagConfirmed` (administrator confirms the taxpayer
holds the B2C tag) and `eta.submissionEnabled` (requires the former). With the
production ETA environment, submission additionally requires
`onboardingStatus = PRODUCTION_AUTHORIZED`.

## Error classification

| ETA outcome | Receipt state | Why |
|---|---|---|
| 202 + acceptedDocuments | SUBMITTED | Received, validation pending |
| 202 + rejectedDocuments | REJECTED | Refused at submission; error stored |
| 202 but receipt not listed | UNKNOWN | Cannot tell |
| 400 BadStructure / MaximumSizeExceeded, 403 IncorrectSubmitter, other 4xx | FAILED | Needs intervention |
| 401 | QUEUED (token dropped) | Not processed |
| 429 | QUEUED with `Retry-After` | Not processed |
| 422 DuplicateSubmission | UNKNOWN | ETA already has this payload |
| 5xx, timeout, network error | UNKNOWN | May have been processed |

## Running against the ETA preprod environment

1. Obtain preprod taxpayer and POS credentials from ETA and complete the POS registration.
2. Set `ETA_TRANSPORT=http`, `ETA_ENVIRONMENT=preprod` and the preprod base URLs.
3. Register the branch with its ETA branch code and the device with its exact serial, OS version and model framework.
4. Enter the device credentials, activate the device, confirm the B2C tag, enable submission.
5. Use product item codes registered for the taxpayer (EGS) or valid GS1 codes.
6. Make a sale, then check the receipt page and **Tax Authority link** page. Record the submission UUID, response and result in the compliance matrix as evidence.
7. Repeat for: rejected receipt (e.g. wrong item code), return receipt, timeout recovery.

## Not implemented (external dependencies)

- Issuer signature (CAdES-BES) — needs the taxpayer's signing device/certificate and the exact signing specification.
- ETA→ERP notification endpoints — polling is used instead.
- Receipt corrections with `referenceOldUUID`.
- QR code content.
