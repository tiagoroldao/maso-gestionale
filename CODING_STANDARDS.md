# Coding standards

Judgement calls the reviewer applies to every diff. Mechanical rules are enforced by lint, typecheck and CI, not here.

## State and integrity

- **Closed means closed everywhere.** A record in a final state (closed Visit, Finalised Invoice) is refused at _every_ entry point that could change it: direct URLs, drag and drop, bulk actions, related records. Check each route touching the model, not only the obvious one.
- **A closed or cancelled Job takes no new work** (ADR 0015): new Visits and changes to its Visits, new Charges (Office's, imported from a Quote, or recorded in the field) and Quotes are refused at every entry point. It still records Payments and Credit Notes, and Office still bills, corrects, marks not billable, or marks done or not done (ADR 0016) the Charges already on it (#111). A closed Job can be reopened; a cancelled one can't, so Office (never a Technician) can still mark done a Visit left open on it, through the same close path as the field (#153).
- **Lock, then check, then write.** A check that guards a write (status, sequence number, stock, "already invoiced") runs inside the transaction on a row locked with `forUpdate()` (or an advisory lock), re-read after locking.
- **Snapshot what bills.** Prices, rates and VAT treatments are copied onto the record when it is written (Charges, Invoice lines), so later settings changes never alter recorded work or issued documents.
- **Archive, don't delete, referenced settings.** Records that others refer to (rates, VAT Codes, Items) are archived; existing references keep them, new records can't pick them, and pickers show an archived value only to the record already using it.
- **Derived indicators work in SQL too.** An indicator computed in TypeScript (a Job's work complete, invoiced and paid) has an SQL equivalent for list filters, and the two agree under test.

## Code

- **One source of truth.** Lists of fixed values (statuses, types, categories) and rules shared by server and pages live once in `shared/`; pages import them rather than copying.
- **Comments stay true.** A comment pointing at an issue still describes that issue's current scope; update it when the issue is re-scoped or delivered.
- **Italian UI.** Every visible word, validation message and flash comes from `resources/lang/it` (ADR 0006); labels and errors read naturally next to each other.

## UI scope

The UI is functional scaffolding until the UX pass (ADR 0009). A screen on the new UI (its content built from the new components in `inertia/components/ui/` and the shell's, with no `Page`, `Section` or `app.css` markup; a screen moves in its own issue, and new screens start there) follows `docs/ui.md` (ADR 0020) in place of "Reachable, not designed". The other rules apply to every screen, "Lists" only until the lists round of the UX pass. In each diff:

- **Reachable, not designed.** A feature gets a plain page from the existing pieces (`Page`, `Section`, `.table`, `.field` classes). New visual components, styles, layout work and interaction niceties (live previews, drag and drop, inline editing) are out unless the feature can't work without them. Destructive actions (delete, cancel, finalise) get a confirmation; nothing else does.
- **Lists** are a plain table in an explicit order (by name, or newest first for dated records). Search only where a record must be found or picked; filters, sorting and pagination only when an acceptance criterion or the data volume needs them.
- **No extras.** No dashboards, reports, summaries or charts beyond the issue's criteria.
- **Rules live in `shared/` or services, never written inside a page.** Totals, statuses and business rules come from services or `shared/` modules; controllers pass plain domain data. A page may run `shared/` rules for live interaction (defaults, previews, totals as you type, enabling a field), and the server runs the same rules again and is authoritative on submit. What a user may do to a record comes from the server (`docs/ui.md`, Actions). Purely visual state (open sections, tabs, unsaved edits) is the page's own.
- **UX gaps found** in review go to `ui-later` (an issue with that label), not into the diff.

## Tests

- **Behaviour at the highest seam.** Functional tests through HTTP for rules and access; one Playwright smoke test per main flow; unit tests for pure modules (totals, due dates, derivations). Checks of a rule at a screen size (below) may be browser tests of their own, beside the flow's smoke test.
- **Browser tests check `docs/ui.md` as behaviour at a screen size, never pixels.** On a screen on the new UI, assert its rules where they depend on the viewport (on a phone the primary action is in the bottom bar, "⋯" opens the other actions, "☰" opens the menu; on a tablet the sidebar is folded to icons). Use the widths in `shared/screen_sizes.ts` (docs/ui.md "Screen sizes"). Positions, sizes and colours are checked with screenshots (`npm run ui:shots`) and accessibility checks, not asserted: a browser test of a screen on the new UI runs axe on it (`seriousA11yViolations` in `tests/helpers/axe.ts`, with `{ content: true }` for a screen inside the app shell, whose content area is otherwise left out) and allows no serious or critical violation.
- **Every role.** Access rules are tested for each role that must be refused, on every verb (GET, POST, PUT, DELETE), not only the page load.
- **Assert the specific outcome**: the exact error field, the stored value, the unchanged record after a refusal; never only "something failed".
