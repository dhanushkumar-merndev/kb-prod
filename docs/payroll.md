# Payroll

Apply `supabase/migrations/202609050001_payroll_simple_design.sql` to the target Supabase environment before releasing this application change. The migration adds salary structures, payable-day snapshots and franchise-scoped payroll generation. Existing payroll amounts and paid history are preserved; old entries without day snapshots display “Unavailable”.

HR or the Director can save monthly components under **Salary setup**, then generate a draft for the selected month. Basic pay continues to come from Employee Records. Salary revisions have an effective month and carry forward automatically. Changes affect newly generated drafts; existing drafts retain their saved figures and audited corrections remain available in employee details.

Monthly basic pay uses distinct approved/corrected attendance days. Approved leave adds payable days only when the employee’s saved salary structure enables paid leave; overlapping leave and attendance count once. Earnings and employer contributions are prorated by payable days divided by calendar days in the month. Configured employee deductions are prorated by period length. PF, ESIC, professional tax and TDS use saved amounts supplied by payroll staff; the application does not infer statutory rates. Daily/hourly and completed-booking earnings retain the existing approved-work rules. Approved expenses are reimbursed once.

Gross salary excludes reimbursements. Net salary includes reimbursements and subtracts employee deductions/advances. Company cost is gross salary plus reimbursements and employer contributions. Reversed entries remain in history and CSV exports, but are excluded from summary totals and payslips.

The page displays **Draft → Review → Approved → Paid** while preserving the existing HR submission, Manager review, Director approval/payment and permanent-lock audit steps. Payslips are available after approval as a printable HTML document that supports Indian-language names; open it and use Print to save a PDF. Payroll export downloads CSV.

Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`. The payroll integration tests run the production payroll SQL in isolated PostgreSQL/WASM with minimal Auth/franchise fixtures. They do not replace the full Supabase database suite (`pnpm supabase:test`) against a locally running Supabase stack.
