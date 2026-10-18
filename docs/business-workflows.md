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

## Reconciliation and reporting

- Shift history shows opening float, expected and counted cash and variance.
- Dashboard: net revenue, sales and returns including tax, gross sales, discounts, tax by type, payments in/out by method, sales by branch and device, ETA status counts. Figures come from issued receipts regardless of ETA acceptance and are labelled as such.
- CSV exports: sales by product, sales by cashier (operational reports, not tax returns).
