# Coding standards

Judgement calls the reviewer applies to every diff. Mechanical rules are enforced by lint, typecheck and CI, not here.

## State and integrity

- **Closed means closed everywhere.** A record in a final state (closed Visit, cancelled Job, Finalised Invoice) is refused at _every_ entry point that could change it: direct URLs, drag and drop, bulk actions, related records. Check each route touching the model, not only the obvious one.
- **Lock, then check, then write.** A check that guards a write (status, sequence number, stock, "already invoiced") runs inside the transaction on a row locked with `forUpdate()` (or an advisory lock), re-read after locking.
- **Snapshot what bills.** Prices, rates and VAT treatments are copied onto the record when it is written (Visit hours, Invoice lines), so later settings changes never alter recorded work or issued documents.
- **Archive, don't delete, referenced settings.** Records that others refer to (rates, VAT Codes, Items) are archived; existing references keep them, new records can't pick them, and pickers show an archived value only to the record already using it.
- **Derived statuses work in SQL too.** A status computed in TypeScript (Work Complete, Invoiced, Closed) has an SQL equivalent for list filters, and the two agree under test.

## Code

- **One source of truth.** Lists of fixed values (statuses, types, categories) and rules shared by server and pages live once in `shared/`; pages import them rather than copying.
- **Comments stay true.** A comment pointing at an issue still describes that issue's current scope; update it when the issue is re-scoped or delivered.
- **Italian UI.** Every visible word, validation message and flash comes from `resources/lang/it` (ADR 0006); labels and errors read naturally next to each other.

## Tests

- **Behaviour at the highest seam.** Functional tests through HTTP for rules and access; Playwright for the main path of each screen; unit tests for pure modules (totals, due dates, derivations).
- **Every role.** Access rules are tested for each role that must be refused, on every verb (GET, POST, PUT, DELETE), not only the page load.
- **Assert the specific outcome**: the exact error field, the stored value, the unchanged record after a refusal; never only "something failed".
