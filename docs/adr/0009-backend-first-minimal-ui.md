# Backend first, minimal UI until a UX pass

**Amended by 0020** (2026-10-30): the UX pass has started. Screens on the new UI follow `docs/ui.md`; the rest stay minimal as below until they move. Decided by the business on 2026-10-30: no screen limits its links to the next step of a workflow any more, and browser tests check the rules of `docs/ui.md` where they depend on the viewport (never pixels) instead of never asserting layout.

Until the app is feature-complete, the interface exists only to exercise and test the backend. Several UX features (styles, navigation, how screens link together, listing conventions, filters, reports) will be designed in a dedicated pass before anyone uses the app day to day, so UI work done now is provisional and is kept to the minimum that makes each feature reachable and testable. The rules that apply to each change are under "UI scope" in `CODING_STANDARDS.md`; UX work found along the way is labelled `ui-later` instead of being built.

## Considered Options

- **Build each screen to a usable standard as we go:** better for early demos, but every listing, filter and link would be designed before the UX pass and then reworked or thrown away.
- **API only, no UI until the UX pass:** the leanest backend, but end-to-end flows (field work, scheduling, invoicing) could only be tried through HTTP calls, and browser tests of the main flows would wait.

## Consequences

- Business rules live in services and `shared/` modules, never in pages, so the UX pass can replace pages without touching the rules.
- Kept on purpose because they're cheap and avoid rework: the Italian text catalogue (ADR 0006), labels and accessible names (the browser tests find elements by them), and visible validation errors.
- Rules are tested over HTTP; Playwright keeps one smoke test per main flow and never asserts layout.
- Pages built before this decision stay as they are; they aren't polished further.
