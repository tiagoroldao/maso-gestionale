# Closing a Job is something Office does

A Job is closed by Office, by hand, when its work is really finished; it is never closed automatically. Paid Invoices don't mean the work is over: a Job can be fully paid with Visits still planned, or still to be booked. So "Closed" is a stored status that Office sets, like "Cancelled", next to the statuses that follow the work (open, in progress, ADR 0013). What used to make a Job closed by itself becomes indicators shown beside its status: work complete (every work Visit done), invoiced (nothing left to bill, every advance taken back) and paid (every Invoice settled after Credit Notes and Payments, ADR 0014). The Jobs list has a "ready to close" filter (work complete, invoiced and paid).

Closing warns but never refuses: if Visits are still planned, Charges are left to bill, Invoices are unpaid or overpaid, or an advance isn't taken back, Office sees what is left and can close anyway, since the record follows what the business knows. A closed Job takes no new work (no Visits, Charges or Quotes), but Payments and Credit Notes against its Invoices are still recorded, as money and corrections arrive after the fact. Office can reopen a closed Job when more work turns up; it goes back to open or in progress by its Visits. Archiving a Customer or a Site needs their Jobs to be closed or cancelled. Decided by the business on 2026-10-28 (#103).

## Considered Options

- **Closed when every Invoice is paid** (until now): no extra step, but it closes Jobs with work still to come, and a Payment removed later silently reopens a Job whose Customer may be archived.
- **Closing refused until everything is settled:** tidy numbers, but it blocks Office from closing a Job the business knows is over (a written-off balance, work cancelled by phone).

## Consequences

- Job statuses: open, in progress, closed, cancelled are stored; work complete, invoiced and paid are derived indicators, in TypeScript and SQL alike.
- Existing Jobs that were derived as closed migrate to closed.
- A cancelled Job can't be reopened, so a Visit left open on it would stay frozen, its Items never off stock and its Charges never billable. Cancelling warns, listing its open Visits, and never refuses; Office can then mark such a Visit done, the only change a cancelled Job's Visits accept. A closed Job's open Visits are reached by reopening it. Decided by the business on 2026-10-28 (#153).
- (Refines ADR 0013, whose derived "closed" this replaces.)
