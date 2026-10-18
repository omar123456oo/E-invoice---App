# Receipt lifecycle

## Steps

1. **Cart (POS)** — the cashier scans items. The browser holds the cart and asks
   `POST /pos/quote` for server-calculated totals after every change.
2. **Checkout** — `POST /pos/checkout` with an `Idempotency-Key`. The server
   re-prices from the catalogue and the tax rules in force, validates discounts,
   buyer identity and payments, then in one transaction:
   advances the device chain, builds the ETA receipt document, computes its UUID,
   stores the immutable receipt (document encrypted), the transaction and payments.
3. **Queue** — if the company has enabled ETA submission the receipt starts in
   `QUEUED`, otherwise `NOT_SUBMITTED` (an operator can queue it later).
4. **Submit** — the worker takes the device's queued receipts in chain order
   (≤100 receipts / 1.4 MB), authenticates the POS, signs (when configured) and
   POSTs the submission.
5. **Record result** — accepted receipts become `SUBMITTED` with `submissionUuid`
   and `longId`; rejected ones `REJECTED` with ETA's error.
6. **Poll** — the worker polls the submission until each receipt is `VALID`,
   `INVALID` or `CANCELLED`.
7. **Reconcile** — any uncertain outcome is resolved by asking ETA for the
   receipt by its UUID before anything is resent.

The issued data never changes after step 2. Only the `eta` sub-document changes.

## ETA state machine

```
NOT_SUBMITTED ──queue──▶ QUEUED ──claim──▶ SUBMITTING
                           ▲                 │
          401 / 429 ───────┘                 ├──202 accepted──▶ SUBMITTED ──poll──▶ VALID ──▶ CANCELLED
                                             ├──202 rejected──▶ REJECTED ──▶ SUPERSEDED
                                             ├──400/403──────▶ FAILED ──operator requeue──▶ QUEUED
                                             └──timeout/5xx/422──▶ UNKNOWN
                                                                     │ reconcile (GET receipt by UUID)
                                                                     ├─ found ─▶ SUBMITTED / VALID / INVALID / CANCELLED
                                                                     └─ not found > 15 min ─▶ QUEUED
SUBMITTED ──poll──▶ INVALID ──▶ SUPERSEDED
```

Allowed transitions are defined in `apps/api/src/modules/receipts/eta-status.ts`
and enforced on every update (`assertTransition`). Status meaning:

| Status | Meaning | Officially registered? |
|---|---|---|
| NOT_SUBMITTED | Issued internally; submission not enabled or not requested | No |
| QUEUED | Waiting to be sent | No |
| SUBMITTING | Request in flight | No |
| UNKNOWN | Outcome uncertain; being reconciled | No |
| SUBMITTED | ETA accepted it for processing (HTTP 202); validation pending | No |
| REJECTED | Rejected at submission | No |
| FAILED | Submission refused for a reason needing intervention | No |
| VALID | ETA status Valid | **Yes** |
| INVALID | ETA status Invalid | No |
| CANCELLED | ETA status Cancelled | No (cancelled) |
| SUPERSEDED | Replaced by a corrected receipt (reserved; correction not implemented) | No |

Printed and on-screen receipts state "Internal receipt — not registered with the
Tax Authority" in every state except `VALID`.

## Safety rules

- One submitter per device at a time (lease lock on the device).
- If any receipt of a device is `UNKNOWN`, newer receipts of that device are not
  sent until it is reconciled (keeps the chain ordered).
- A worker that dies mid-request leaves `SUBMITTING` receipts; the next run with
  the lease moves them to `UNKNOWN`, never back to `QUEUED`.
- A return receipt waits until its original sale is `VALID`; if the original is
  rejected/invalid the return fails with an explanation.
- Credentials errors and throttling set `nextAttemptAt`; saving new device
  credentials clears the credential backoff.
