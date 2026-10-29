# The UX pass: "Carbonio", on shadcn-vue and Tailwind

ADR 0009 kept the interface to plain functional pages until a dedicated UX pass. This starts that pass. The business chose the look on 2026-10-29/30 from three prototyped directions (design canvas "Maso Gestionale UI directions", page Carbonio): **Carbonio**, built from the company logo: black letterforms, one red cut, a wide geometric typeface. The rules every screen follows are in `docs/ui.md`; this records why they are what they are.

- **Components: shadcn-vue on Reka UI, styled with Tailwind v4.** Reka UI gives accessible behaviour (dialogs, comboboxes, menus, sheets, focus and keyboard handling) that the hand-built pickers re-implement; shadcn-vue copies styled components into the repo, so they are ours to change. Tailwind keeps a component's styles beside its markup: an agent changing one screen edits one file, deleted markup takes its styles with it, and a fixed scale of tokens keeps spacing and colour consistent across agents. Colours stay CSS variables, light and dark.
- **The look:** a black sidebar in both themes; white (desktop) and black (phone) screen headers; near-square corners (3px) and flat bordered surfaces, shadows only on what floats; Inter for text with tabular figures, Montserrat for the wordmark and spaced-capital section labels; status tags in sentence case. Brand red is a mark, not a colour for controls: the logo cut, the active menu item, the focus ring. Primary buttons are black, so red never reads as both "go" and "danger".
- **One screen anatomy, whatever the record.** Every screen is a List, an Entity screen (one record) or a bespoke screen, with the same header, the same action placement and the same menu, varying only by screen size. A Visit's phone screen is an Entity screen like any other, not a special case.
- **Responsive, with no drag and drop.** Every screen works on a phone. Drag and drop goes (the Agenda's moves, the Invoice sections' reordering) in favour of explicit actions with a preview, which also work on touch.
- **Moving over one piece at a time.** Tailwind and the components live beside `inertia/css/app.css` until it is empty; the app shell moves first, then each screen pattern, screen by screen. Browser tests find elements by label, so they survive the restyle.

## Considered Options

- **Officina** (light sidebar, closest to today's pages) and **Cantiere** (roomy, rounded cards on the logo's grey): kept on the canvas's Archivio page. Carbonio was preferred for carrying the brand without colouring the controls.
- **Keep hand-written CSS** (classic, or Bootstrap/SASS): full control and familiar, but every agent adds selectors and none removes them, the cascade makes each change a search, and the accessible pieces (comboboxes, dialogs) stay ours to build.
- **A full component library** (PrimeVue, Vuetify): complete, but its look is hard to leave and its components can't be edited in place.
- **Bottom tabs on the phone:** the role's main destinations always one tap away, but a second navigation model beside the sidebar, and a second bar stacked with the primary-action bar. The phone instead opens the same sidebar as a drawer from a menu button that is always there.
- **One big restyle:** one review instead of many, but a diff no one can review and a `main` half-converted for weeks.

## Consequences

- ADR 0009's "minimal UI" holds for screens not yet moved; a moved screen follows `docs/ui.md`, and `CODING_STANDARDS.md` "UI scope" says which applies.
- Each screen declares its actions once, ranked primary, secondary or overflow; the server sends only those the user's role allows. The same declaration renders as header buttons on desktop and as the bottom bar, header buttons and "⋯" on the phone.
- Every screen has one canonical place in the hierarchy (its breadcrumb), so a link always opens the same page however it was reached.
- The logo is traced by hand until the business supplies a vector file.
- Lists and filters are a later round of the pass, not decided here.
