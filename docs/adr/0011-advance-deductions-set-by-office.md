# Advance deductions: Office decides how much each Invoice takes back

An Advance Invoice bills part of a Job up front, and later Invoices of the Job take it back. Any Job Invoice can take back any issued advance, partly or fully: Office sets, on each draft, how much of each advance it takes back, VAT included. The amount is split over the advance's VAT rows in proportion to their totals, and each row becomes a negative deduction line at that row's VAT treatment, naming the advance. A draft that bills everything still outstanding starts with what is left of each advance, which is the usual case. Other drafts start with none. Office can change both. An amount can't be more than what is left of its advance, and an Invoice's total can't go below zero. Both are checked when the draft is saved and again when it is finalised, with the Job locked. Each advance's state comes from the Invoices that took it back: not, partly or fully deducted. Only issued Invoices count. A Job is fully invoiced when no Charge is outstanding and every advance is fully deducted. Decided by the business on 2026-10-28 (#116).

## Considered Options

- **The draft that bills the last of the work takes every advance back in full** (#23, until now): no decisions for Office, but the Job gets stuck when the last work is smaller than the advances. For example, a 500 advance and a 35 call-out give a negative draft that can't be issued. An advance issued after that draft also has nothing left to take it back.
- **Deduct automatically up to what each draft bills:** never negative, but the advance is spread over whichever Invoices happen to come next, at amounts nobody chose. The Customer would see several small deductions instead of one on the final Invoice.
- **Only the final Invoice deducts:** simple to explain, but it can't help when the final Invoice is small, and "final" has to be guessed while Visits can still be planned.

## Consequences

- Deductions are stored per Invoice and advance (`advance_deductions`), VAT included. Deduction lines are written from them on every save and again when finalising, so Office can't edit those lines directly.
- Taking back all that is left of an advance takes back exactly each VAT row's remaining taxable amount, so a fully deducted advance closes to the cent. A partial amount's VAT, worked out on the Invoice's own VAT summary, may differ from the amount entered by a cent.
- A Quoted Job has a single Invoice of its own, from its Quote, until Charges are invoiced on Quoted Jobs too (#117). An advance it doesn't fully take back stays partly deducted, and the Job is never Invoiced. A Quoted Job's advance can be issued only until the Quote's Invoice is issued.
- An advance taken back on a rejected Invoice counts as taken back, since the Invoice keeps its number. Correcting the advance itself after it was taken back isn't checked against its deductions yet.
