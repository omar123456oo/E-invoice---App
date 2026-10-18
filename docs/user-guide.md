# User guide

The interface is in Arabic by default; use the language button at the bottom of
the side menu to switch to English.

## Signing in

Enter your email and password. If your account has two-step verification, enter
the six-digit code from your authenticator app when asked. After five wrong
passwords the account is locked for 15 minutes. Use **Forgot your password?** to
get a reset link by email.

## Cashier: selling

1. Open **Point of sale**. Choose your device and enter the opening cash, then **Open shift**.
2. Scan a barcode, or type part of a name or code and press Enter. Press **F2** at any time to return to the search box.
3. Change quantities with − and +, or type a quantity. Enter a discount percentage if allowed.
4. The amount to pay is calculated by the server. Wait until it shows.
5. Choose **Cash** and type the cash received to see the change, or **Card** and type the authorization code printed by the card terminal. Never type the card number. Use **Split payment** to combine methods.
6. Press **Complete sale** (or **F9**). If asked, enter the buyer's name and national ID.
7. Print the receipt. While the Tax Authority has not confirmed it, the receipt says it is an internal receipt; that is expected.
8. At the end of the day choose **Close shift** and enter the cash you counted. Any difference is recorded.

## Returns

Open the receipt (**Receipts**, search by number) and choose **Start a return**.
Enter the quantity for each item being returned, a reason and how the money is
refunded. Large or late returns wait for a manager's approval on the **Returns**
page. When approved, choose the device and **Issue return receipt and refund**.

## Receipt statuses

| Status | What it means | What to do |
|---|---|---|
| Not sent | Sending to the Tax Authority is not enabled or not requested | A manager can send it from the receipt page |
| Waiting to send / Sending | In the queue | Nothing |
| Received — in review | The Tax Authority received it and is validating | Nothing |
| Valid and registered | Officially registered | Nothing |
| Being verified | The last attempt's outcome is unknown; the system is checking | Wait, or use **Check status with the Tax Authority** |
| Rejected / Invalid | The Tax Authority refused it; the error is shown on the receipt page | Fix the cause (often a product code) and contact your administrator |
| Sending failed | A configuration or format problem | Fix the cause, then **Resend after fixing** |

## Managers and administrators

- **Products**: official code type and code must come from the Tax Authority code registry. Mark the code status **Approved** once confirmed.
- **Tax rules**: each change creates a new version with the date it takes effect and who verified it.
- **POS devices**: register each device with the serial number registered with the Tax Authority, enter its credentials (they cannot be viewed afterwards) and activate it.
- **Company**: payment methods, the amount above which buyer identity is required, return limits, maximum cashier discount, and the Tax Authority switches (B2C tag confirmed, sending enabled).
- **Tax Authority link**: environment, warnings, receipts by status and recent submission attempts; **Run sending and follow-up now** processes pending work immediately.
- **Users**: add users, deactivate them or sign them out everywhere.
- **Audit trail**: search events and **Verify integrity** to check nothing was altered.
