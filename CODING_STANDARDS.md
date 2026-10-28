# Coding standards

Judgement calls the reviewer applies to every diff. Mechanical rules are enforced by lint, typecheck and CI, not here.

## State and integrity

- **Closed means closed everywhere.** A record in a final state (closed Visit, Finalised Invoice) is refused at _every_ entry point that could change it: direct URLs, drag and drop, bulk actions, related records. Check each route touching the model, not only the obvious one.
- **A closed or cancelled Job takes no new work** (ADR 0015): new Visits and changes to its Visits, new Charges (Office's, imported from a Quote, or recorded in the field) and Quotes are refused at every entry point. It still records Payments and Credit Notes, and Office still bills, corrects or marks not billable the Charges already on it (#111). A closed Job can be reopened; a cancelled one can't.
- **Lock, then check, then write.** A check that guards a write (status, sequence number, stock, "already invoiced") runs inside the transaction on a row locked with `forUpdate()` (or an advisory lock), re-read after locking.
- **Snapshot what bills.** Prices, rates and VAT treatments are copied onto the record when it is written (Charges, Invoice lines), so later settings changes never alter recorded work or issued documents.
- **Archive, don't delete, referenced settings.** Records that others refer to (rates, VAT Codes, Items) are archived; existing references keep them, new records can't pick them, and pickers show an archived value only to the record already using it.
- **Derived indicators work in SQL too.** An indicator computed in TypeScript (a Job's work complete, invoiced and paid) has an SQL equivalent for list filters, and the two agree under test.

## Code

- **One source of truth.** Lists of fixed values (statuses, types, categories) and rules shared by server and pages live once in `shared/`; pages import them rather than copying.
- **Comments stay true.** A comment pointing at an issue still describes that issue's current scope; update it when the issue is re-scoped or delivered.
- **Italian UI.** Every visible word, validation message and flash comes from `resources/lang/it` (ADR 0006); labels and errors read naturally next to each other.

## UI scope

The UI is functional scaffolding until the UX pass (ADR 0009). In each diff:

- **Reachable, not designed.** A feature gets a plain page from the existing pieces (`Page`, `Section`, `.table`, `.field` classes). New visual components, styles, layout work and interaction niceties (live previews, drag and drop, inline editing) are out unless the feature can't work without them. Destructive actions (delete, cancel, finalise) get a confirmation; nothing else does.
- **Lists** are a plain table in an explicit order (by name, or newest first for dated records). Search only where a record must be found or picked; filters, sorting and pagination only when an acceptance criterion or the data volume needs them.
- **Links** only where a workflow needs the next step (a Job to its Quote, a draft Invoice back to its list). No dashboards, reports, summaries or charts beyond the issue's criteria.
- **Logic stays out of pages.** Rules, totals and statuses come from services or `shared/` modules; controllers pass plain domain data.
- **UX gaps found** in review go to `ui-later` (an issue with that label), not into the diff.

## Tests

- **Behaviour at the highest seam.** Functional tests through HTTP for rules and access; one Playwright smoke test per main flow, never asserting layout; unit tests for pure modules (totals, due dates, derivations).
- **Every role.** Access rules are tested for each role that must be refused, on every verb (GET, POST, PUT, DELETE), not only the page load.
- **Assert the specific outcome**: the exact error field, the stored value, the unchanged record after a refusal; never only "something failed".
