# Charges have a work state and a billing state

A Charge has two states, each worked out from its history (ADR 0010). Its **work state** says whether it happened: **planned** (_previsto_), **done** (_eseguito_) or **not done** (_non eseguito_). Its **billing state** says whether the Customer has been charged: to bill, in draft, billed, not billable, credited. Stock follows the work state alone; Invoices follow the billing state, which only acts on done Charges.

Stock: a planned Item Charge is **committed** (_impegnato_), still in the warehouse but spoken for, so an Item's available quantity is its stock less what is committed, and reorder alerts use what is available; a done Item Charge leaves stock when it becomes done; a not done one never touches stock. A warning, never a refusal, shows when planned work would take available below zero.

Work state: Charges on a Visit are planned (recorded in advance, or imported from a Quote) until the Visit closes, when they become done. Closing shows them for review, all ticked, so what wasn't used is unticked and becomes not done; Office can switch a Charge between done and not done afterwards, until it is billed, and stock follows. Cancelling a Visit makes its Charges not done, and restoring it makes them planned again. A cancelled Visit (_annullato_) keeps its record, takes nothing off stock, and doesn't count as work. On the Job itself, Charges Office records start done (a call-out, a contractor's day, usually entered after the fact), and Charges imported from a Quote start planned until Office confirms them used, when they leave stock (replacing ADR 0012's "Job Charges never move stock").

Billing: only done Charges can be billed; a planned Charge keeps the Job's billing open, since its work is still to come. "Not billable" can be decided at any time, even while planned (warranty work), and takes effect when done. A billed Charge is frozen, its work state and its recorded quantity alike: anything wrong on billed work is undone with a Credit Note first (it becomes credited, ADR 0014), after which it can be corrected. Decided by the business on 2026-10-29.

## Considered Options

- **One state for everything** (until now, with "not billable" or a new "not carried out" state added): "not billable" means the work happened but isn't charged, which is wrong for work that never happened, and one state can't say at once whether stock moved and whether the Customer paid.
- **Corrections to billed Charges at any time** (ADR 0010 until now): convenient, but recorded and billed values then drift apart on issued documents.
- **Job Charges as billing only, never moving stock** (ADR 0012): simple, but planned material for a Job would be invisible to stock and never leave it.

## Consequences

- A cancelled Visit status, with restore.
- Stock shows in stock, committed and available per Item.
- Existing data: Charges on closed Visits are done, on open Visits planned; Job Charges are done, except Item Charges imported from a Quote, which are planned.
- (Refines ADR 0010's corrections "at any time" and ADR 0012's Job Item Charges.)
