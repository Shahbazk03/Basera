# Commissions & finance

## Four different amounts — never mixed

| Amount | Where | Notes |
| --- | --- | --- |
| **Property deal value** | `deals.dealValue` | Agreed price between buyer and seller; not money the company holds |
| **Customer money received** | `deal_payments` | Token/booking amounts paid by the customer, with who received them (company, developer, owner). Only money the company itself receives also enters the ledger, as a `CUSTOMER_PAYMENT` inflow (never revenue); removing such a payment posts a reversing outflow instead of deleting ledger history |
| **Company revenue** | invoices + `INVOICE_RECEIPT` transactions | What the company bills and actually receives |
| **Commission payable / paid** | `commission_records` / `commission_payouts` | Owed to employees, brokers, lead providers, partners |

A converted lead or a booked deal does not imply any payment has been received.

## Commission rules
Rules are configuration (no hard-coded rates): recipient type (company, broker, sales employee, sales manager, lead provider, partner), fixed or percentage, basis (deal value or expected company revenue), optional filters (deal type, project, property type, city, lead provider, broker organisation), minimum deal value, maximum payout, priority and effective dates. `calculateCommission` in `@estate/shared` computes amounts in paise.

## Commission lifecycle
`PENDING_APPROVAL → APPROVED → PAYABLE → PAID` (or `CANCELLED` before payment).
- Records are generated from eligible deals (booked / agreement signed / closed won) — idempotently, so re-running never duplicates — or created manually with a note.
- Approval requires `commission.approve`; nobody approves their own commission.
- **Payouts** group payable records of one recipient; paying a payout records a `COMMISSION_PAYOUT` transaction. Employee incentives can instead be paid through payroll (a payroll adjustment for the chosen month).
- Recipients see a statement of their own records (brokers and lead providers see their organisation's).

## Finance records
- **Transactions**: the ledger of money in/out (customer payments, invoice receipts, commission payouts, salary payments, expense and reimbursement payments, refunds, other).
- **Invoices**: lines with per-line tax rate entered by the accountant (no rate is assumed); issue, record receipts (overpayment refused), cancel; statuses DRAFT/ISSUED/PARTIALLY_PAID/PAID/CANCELLED.
- **Expenses**: categorised, with receipts; approval by someone other than the creator; marking paid records a transaction.
- **Reimbursements**: employees claim with a receipt; managers or finance approve (never their own); paid directly or via payroll.
- **Reports**: monthly revenue vs. customer money received (shown separately), commissions payable vs. paid, expenses by category, payroll cost — exportable as CSV.
