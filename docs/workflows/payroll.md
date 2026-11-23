# Payroll

Nothing about pay is hard-coded: salary components, structures, statutory components and their rates are configuration. The seed only contains clearly labelled development samples.

## Configuration
- **Salary components** (`salary_components`): code, earning/deduction, calculation type, default value, optional monthly cap, statutory/taxable flags, whether it is pro-rated by attendance.
- **Salary structures** (`salary_structures`): per employee, versioned by effective date; each line supplies the monthly amount (fixed) or percentage (percentage types).
- **Adjustments** (`payroll_adjustments`): one-off incentives, bonuses, arrears, reimbursements or recoveries for a month. Commission incentives and reimbursements paid through payroll arrive here from the finance module.

## Run workflow
1. **Create** a run for a month (one active run per month).
2. **Calculate** — for each employee employed during the period: take the structure in effect, compute working days (shift weekly offs and holidays excluded, joiners/leavers pro-rated), loss-of-pay days, then apply the formulas below. Payslips and line items (with a human-readable explanation of every amount) are stored; pending adjustments are marked applied.
3. **Review** totals and warnings (e.g. missing BASIC component, deductions exceeding earnings). Recalculate as often as needed before approval.
4. **Approve** — requires `payroll.approve` and, when maker-checker is on (default), a different person from the one who calculated the run. Approval is recorded per payslip: an approver approves every pending payslip **except their own**, which stays pending until another approver approves it — nobody ever approves their own pay. The run becomes **APPROVED** (and payslips are released to employees) once no payslip is pending. Recalculating before that discards partial approvals, because the amounts change.
5. **Record payments** (bank transfer/UPI/cheque/cash with reference) — each payment also creates a ledger transaction. The run becomes **PAID** when every payslip is paid.
6. Employees see their own payslips only; salary data of others is never exposed to employees.

## Formulas (`calculatePayslip` in `@estate/shared`, unit-tested)

| Item | Formula |
| --- | --- |
| Proration | `payableDays / workingDays` (components with "pro-rate by attendance") |
| Fixed earning/deduction | `value × proration` |
| % of Basic (earning) | `BASIC monthly × value% × proration` |
| % of Basic (deduction) | `earned BASIC × value%` |
| % of Gross (deduction) | `earned gross of salary components × value%` (one-off adjustments excluded) |
| Cap | `min(amount, maxAmount)` when a cap is configured |
| Adjustments | Incentive/bonus/arrears/reimbursement add to earnings; deduction adds to deductions |
| Net pay | `total earnings − total deductions`, never below zero (a warning is raised instead) |

**Loss of pay (LOP)** = approved unpaid-leave days + uncovered half-day shortfalls (0.5) + — only when the setting `payroll.lopForUnmarkedDays` is on — working days with neither attendance nor approved leave.

All money arithmetic is done in integer paise.

## Statutory components
Provident fund, ESI, professional tax and TDS rules differ by state, salary band and regime and change over time. They are **not** computed automatically: configure them as components with the rates and caps advised by your payroll consultant, and review payslips before approval.
