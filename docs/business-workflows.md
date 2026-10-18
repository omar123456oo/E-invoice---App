# Business workflows

## Onboarding a company

1. Platform admin creates the company and its owner (`POST /platform/tenants`).
2. Owner records legal details, payment methods and limits (Company page).
3. Owner registers branches with the **ETA branch code** and address.
4. Owner registers POS devices with the exact ETA serial, OS version and model framework, enters ETA credentials and activates them after ETA activation.
5. Tax rules are entered as versions, each with its verification source (who verified, when, against what). No rate is shipped with the product.
6. Products are created or bulk-imported (dry run first) with official item codes; mark codes **Approved** once confirmed in ETA code management.
7. After confirming the B2C tag, the owner enables ETA submission.

## Selling (cashier)

1. Open a shift on the device with the opening cash float.
2. Scan or search products; adjust quantity and discount (above the company limit requires a manager).
3. Choose cash (enter cash received; change is shown), card (enter the terminal authorization code — never the card number), wallet, or split tender.
4. Complete the sale (F9). If the total reaches the buyer-identity threshold the POS asks for the buyer's national ID and name.
5. Print the receipt. Until ETA validates it, the slip says it is an internal receipt.
6. Close the shift with the counted cash; expected cash and variance are recorded.

A retried checkout (network failure) re-uses the cart's idempotency key, so the sale is never duplicated.

## Returns and refunds

1. From the original receipt, choose **Start a return**, pick quantities (up to what remains returnable), give a reason and the refund method.
2. If the refund exceeds the company's approval amount or the sale is older than the approval window, the return waits for a finance manager. Requesters cannot approve their own returns.
3. Once approved, a cashier with an open shift **issues the return receipt and refund**. Amounts are derived from the original receipt (same prices, proportional discounts and taxes), never from today's prices.
4. The return receipt references the original UUID and is sent to ETA after the original is VALID.

Three separate records exist: the return request, the refund payment (money out) and the return receipt (tax document).

## ETA operations

- **Receipts needing attention** appear on the dashboard (rejected, failed, invalid, unknown).
- `FAILED` receipts can be re-queued after the cause is fixed (permission `receipts:submit`).
- `UNKNOWN` receipts can be checked immediately with **Check status with the Tax Authority**.
- **Run sending and follow-up now** on the Tax Authority link page triggers a sweep.

## Correcting a rejected or invalid receipt

1. Open the receipt (the dashboard and notifications link to it) and read the Tax Authority's error.
2. Fix the cause in the master data, usually the product's official item code.
3. Choose **Issue corrected receipt**: use the current product codes, or edit the codes per line, and give a reason.
4. The corrected receipt is queued and sent; the original is shown as superseded. This is allowed for 96 hours after issue.

## Notifications

Users receive in-app notifications (and email, when the company enables email
alerts) for: receipts rejected, invalid or failed at the Tax Authority; receipts
not registered 20 hours after issue; cash variances at shift close; finished or
failed imports; background jobs that failed permanently. Recipients are the users
whose role can act on the problem.

## Imports

- **Products**: download the CSV template, fill it (or an Excel sheet with the same columns), upload it, review the row-by-row preview, then import the valid rows. Rows are re-validated at import time.
- **Documents** (supplier invoices, existing official receipts, other documents as PDF/JPG/PNG): upload, then record the document's data in the review form. The system recalculates totals and asks you to confirm any difference. Documents are kept for reference and never become tax receipts.
- Every upload is checked by content, scanned for malware when a scanner is configured, and stored privately; uploading the same file twice returns the earlier upload.

## Reconciliation and reporting

- Shift history shows opening float, expected and counted cash and variance.
- Dashboard: net revenue, sales and returns including tax, gross sales, discounts, tax by type, payments in/out by method, sales by branch and device, ETA status counts. Figures come from issued receipts regardless of ETA acceptance and are labelled as such.
- Reports (screen, CSV and Excel): sales by product, sales by cashier, tax summary by type/sub-type/rate net of returns, returns and refunds, Tax Authority processing (receipts needing attention), shift reconciliation. These are operational reports, not tax returns.
