# UI conventions ("Carbonio", ADR 0020)

Rules for every screen on the new UI: a screen is on it once it renders inside the new app shell, and once the shell exists new screens start there. Other screens follow "Reachable, not designed" in `CODING_STANDARDS.md` (ADR 0009); see its "UI scope" for which of its rules every screen keeps. The mockups these rules come from are on the design canvas "Maso Gestionale UI directions", page Carbonio.

## Screen sizes

- **Phone:** under 768px. **Tablet:** 768–1023px, the desktop rules with the sidebar folded to icons. **Desktop:** 1024px and up.
- Every screen works on a phone. No drag and drop: an explicit action, with a preview of the result where it changes a time or an order.

## Kinds of screen

- **List:** a collection of one kind of record (Commesse, Clienti, Fatture). Its layout and filters are still to be decided.
- **Entity screen:** one record (a Job, a Visit, an Item, an Invoice). A form to create or edit one is an Entity screen in edit mode.
- **Bespoke:** Agenda, dashboards. Only the header and menu rules apply.

## Header

Every screen has one, with the same parts in the same order: where you are, the title, status tags, one line of identifying facts, the actions.

|               | Desktop                                               | Phone                                                  |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Band          | White, across the top of the content                  | Black, across the top of the screen                    |
| Where you are | Breadcrumb: the canonical path                        | "‹" back button, top left, labelled with where it goes |
| Menu          | The sidebar                                           | "☰", always top right, on every screen                |
| Title         | The record's name; a Visit is "Intervento · Customer" | Same                                                   |

## Actions

A screen declares its actions once, each ranked **primary** (at most one), **secondary** or **overflow**. The server sends only the actions the user's role allows. An action blocked by the record's state is hidden, or shown disabled with its reason where the user would expect it.

|                                  | Desktop                                | Phone                                                   |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| Primary                          | Black button, after the secondary ones | Black bar fixed at the bottom of the screen             |
| Secondary                        | Up to 2 bordered buttons in the header | Up to 2 buttons in the black header's action row        |
| Overflow, and secondary beyond 2 | "⋯" button, last                       | Square "⋯" button at the end of the header's action row |

On desktop the header's buttons read: secondary, primary, "⋯". Destructive actions (delete, cancel, set back to bill) are always overflow and always confirmed; irreversible ones (finalise) are confirmed too; nothing else is. Contact actions (Mappa, Chiama) are secondary.

## Entity screen body

- **The same on every Entity:** a key-facts band of 3–4 facts under the header (desktop: one row; phone: a two-column grid), then sections.
- **Bespoke per Entity:** which facts and sections. The section holding the screen's main work takes the main column on desktop; supporting sections take the side column. On the phone everything stacks, and a section's table becomes a list of rows.

## Menu

- **Desktop:** the black sidebar, grouped by area (Lavoro, Fatturazione, Magazzino, Anagrafiche, Impostazioni at the end), showing only what the role can open. The active item is marked with the red cut.
- **Phone:** the same sidebar, as a drawer from the right, opened by "☰". Same groups, same items, plus search and the user at the bottom.
- A Technician's menu is short: I miei interventi. Whether Technicians also get an Agenda (read-only) or a screen for today is still to be decided.

## Hierarchy and references

- **One canonical place.** Every screen has one parent, whatever route reached it: an Item sits under Articoli, a Visit under its Job (under I miei interventi for a Technician, who can't open Jobs). The desktop breadcrumb shows that path.
- **Back on the phone** goes to the previous screen when it was inside the app, otherwise to the canonical parent; its label says which.
- **Preview or page.** A record referenced from lines or Charges inside another record (an Item in a Visit's Charges, a line on an Invoice) opens a preview: a bottom sheet on the phone, a side panel on desktop, with "Apri scheda" for its page. Every other link opens the page.
- **Dialogs** only for short, focused tasks: a confirmation, a small form ("+ Ore"), moving a Visit with a preview. Never a whole record.

## Look

- **Colours** are CSS variables, light and dark; the system setting decides, the user can override. Black and white for controls and text; status colours (blue planned, orange in progress or to bill, green done or paid, grey draft) in tinted tags, never colour alone.
- **Brand red** is a mark only: the logo cut, the active menu item, the focus ring. Errors use red too, always with an icon and words.
- **Type:** Inter with tabular figures for text and numbers; Montserrat for the wordmark and section labels (spaced capitals). Status tags in sentence case. Fonts are self-hosted.
- **Shape:** 3px corners, flat bordered surfaces; shadows only on what floats (menus, sheets, dialogs, toasts). Touch targets at least 44px.
- **Density:** compact on desktop, roomier on touch screens; the same components, spaced by screen size.
