# UI conventions ("Carbonio", ADR 0020)

Rules for every screen on the new UI: a screen is on it once its content is built from the new components (`inertia/components/ui/` and the shell's), with no `Page`, `Section` or `app.css` markup. A screen moves in its own issue; new screens start there. Every page already sits inside the app shell (#234), except sign-in, first-run setup and the error pages, which sit outside it with no menu (#247); being inside the shell alone doesn't make it a screen on the new UI. Which rules apply to which screens is under "UI scope" in `CODING_STANDARDS.md`. The mockups these rules come from are in `docs/ui/mockups/` (copied from the design canvas "Maso Gestionale UI directions", page Carbonio).

## Screen sizes

- **Phone:** under 768px. **Tablet:** 768–1023px, the desktop rules with the sidebar folded to icons. **Desktop:** 1024px and up.
- **Checked at** 390px (phone), 820px (tablet) and 1440px (desktop): `shared/screen_sizes.ts`, used by `npm run ui:shots` and by the browser tests that check a rule at a screen size.
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

- **Declared as data.** The controller sends the screen's `actions` prop, built with `declareActions()` (`shared/screen_actions.ts`, which refuses a second primary or an unconfirmed destructive action): each with a name, a label the server already translated, its rank, and what it does: open a page (`link`), post to a route (`post`, with the `confirm` question when it needs one), or open the page's own short form (`dialog`, opened by name). The role and the record's state decide what is sent; the page never filters them again. The Job's are in `app/services/job_actions.ts`.
- **Hidden or disabled.** An action the state makes meaningless is hidden (no new Visit on a closed Job). The primary is the exception: it stays, disabled with its reason shown beside it, since the user looks for it there (the Job's draft Invoice when nothing is to bill, or a draft already waits). Use `disabledReason` elsewhere only where a user would otherwise search for a missing action.
- **Header or section.** The header holds the record's own actions. Adding to a section ("Aggiungi addebito") sits in that section's header, and acting on one row in its row; the server still decides whether they show (through the page's props).
- **Confirmations** use the confirmation dialog (`confirm_dialog.vue`), never `window.confirm`: titled with the action, the question as its text, the action's own label on its button.
- **Deleting through a `DELETE` route** is declared as a `dialog` action, still destructive with its `confirm` question: the page asks it in the confirmation dialog, then sends the `DELETE` itself (the Item's Elimina, `app/services/item_actions.ts`).

## Entity screen body

- **The same on every Entity:** a key-facts band of 3–4 facts under the header (desktop: one row; phone: a two-column grid), then sections.
- **Facts line or key facts.** The header's line names the record: its number, its kind, the dates of its state ("2026/0005 · Riparazione · aperta il 20/10/2026"), as plain text. The key-facts band holds what the user acts on: who and where (linked to their pages) and the money, each value with an optional hint ("su 2.388,00 € registrati").
- **Bespoke per Entity:** which facts and sections. The section holding the screen's main work takes the main column on desktop; supporting sections take the side column. On the phone everything stacks, and a section's table becomes a list of rows.

## Menu

- **Desktop:** the black sidebar, grouped by area (Lavoro, Fatturazione, Magazzino, Anagrafiche, Impostazioni at the end), showing only what the role can open. The active item is marked with the red cut.
- **Phone:** the same sidebar, as a drawer from the right, opened by "☰". Same groups, same items, plus search and the user at the bottom.
- A Technician's menu is short: I miei interventi. Whether Technicians also get an Agenda (read-only) or a screen for today is still to be decided.

## Hierarchy and references

- **One canonical place.** Every screen has one parent, whatever route reached it: an Item sits under Articoli, a Visit under its Job (under I miei interventi for a Technician, who can't open Jobs). The desktop breadcrumb shows that path.
- **Back on the phone** goes to the previous screen when it was inside the app, otherwise to the canonical parent; its label says which. For now it always goes to the canonical parent (the breadcrumb's last step), which the screen header hands to the shell's bar (`docs/follow-ups.md`).
- **Preview or page.** A record referenced from lines or Charges inside another record (an Item in a Visit's Charges, a line on an Invoice) opens a preview: a bottom sheet on the phone, a side panel on desktop, with "Apri scheda" for its page. Every other link opens the page.
- **A preview** (`record_preview.vue`, #236) shows the record's name as on its page (its kind above, its code and the like under), two or four facts in a two-column grid, then "Apri scheda" and "Chiudi". The side panel starts at 768px (tablet and desktop) and is full height on the right. It is modal: focus stays inside, Esc closes it, and focus goes back to the row that opened it. Its data comes as JSON from the record's `…/:id/preview` route, beside its page and open to the same roles; the screen sends the record's id on the row only when the user may open it, and the row's name is then a button. The Item's is `item_preview.vue`, opened from a Job's Charges.
- **Dialogs** only for short, focused tasks: a confirmation, a small form ("+ Ore"), moving a Visit with a preview. Never a whole record.

## Look

- **Colours** are CSS variables, light and dark; the system setting decides, the user can override. Black and white for controls and text; status colours (blue planned, orange in progress or to bill, green done or paid, grey draft) in tinted tags, never colour alone.
- **Brand red** is a mark only: the logo cut, the active menu item, the focus ring. Errors use red too, always with an icon and words.
- **Type:** Inter with tabular figures for text and numbers; Montserrat for the wordmark and section labels (spaced capitals). Status tags in sentence case. Fonts are self-hosted.
- **Shape:** 3px corners, flat bordered surfaces; shadows only on what floats (menus, sheets, dialogs, toasts). Touch targets at least 44px.
- **Density:** compact on desktop, roomier on touch screens; the same components, spaced by screen size.
