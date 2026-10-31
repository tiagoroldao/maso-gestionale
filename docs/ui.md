# UI conventions ("Carbonio", ADR 0020)

Rules for every screen on the new UI: a screen is on it once its content is built from the new components (`inertia/components/ui/` and the shell's), with no `Page`, `Section` or `app.css` markup. A screen moves in its own issue; new screens start there. Every page already sits inside the app shell (#234), except sign-in, first-run setup and the error pages, which sit outside it with no menu (#247); being inside the shell alone doesn't make it a screen on the new UI. Which rules apply to which screens is under "UI scope" in `CODING_STANDARDS.md`. The mockups these rules come from are in `docs/ui/mockups/` (copied from the design canvas "Maso Gestionale UI directions", page Carbonio).

## Screen sizes

- **Phone:** under 768px. **Tablet:** 768–1023px, the desktop rules with the sidebar folded to icons. **Desktop:** 1024px and up.
- **Checked at** 390px (phone), 820px (tablet) and 1440px (desktop): `shared/screen_sizes.ts`, used by `npm run ui:shots` and by the browser tests that check a rule at a screen size.
- Every screen works on a phone. No drag and drop: an explicit action, with a preview of the result where it changes a time or an order.

## Kinds of screen

- **List:** a collection of one kind of record (Commesse, Clienti, Fatture). Plain for now ("Lists"); its layout and filters are still to be decided (#237).
- **Entity screen:** one record (a Job, a Visit, an Item, an Invoice). A form to create or edit one is an Entity screen in edit mode: the page wraps the screen in its form, its only action is Save (primary, `saveActions()`; a record edited in place on its own screen, a draft Quote, or whose editor is its only page, a Document Template, keeps its own actions beside Save), and it sits under the record it edits (breadcrumb "Clienti / Mario Rossi / Modifica", the record's name as title) or, when new, under the list or the record it is created for. A record with no page of its own (a Supplier) sits under its list, its name as title and breadcrumb's last step.
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

- **Declared as data.** The controller sends the screen's `actions` prop, built with `declareActions()` (`shared/screen_actions.ts`, which refuses a second primary or an unconfirmed destructive action): each with a name, a label the server already translated, its rank, and what it does: open a page (`link`), post to a route (`post`, with the `confirm` question when it needs one), open the page's own short form (`dialog`, opened by name), or submit the screen's form (`submit`: Save in edit mode, from `saveActions()`; a real submit button, so Enter in a field saves too, held while the form is sent by the screen's `busy`). The form wraps the screen, or, when it doesn't wrap the header, the action names its id (`form`). The role and the record's state decide what is sent; the page never filters them again. A contact action is a `link` to a `tel:` or map URL, rendered as a plain link (a web one in a new tab). A `link` to a file of the app (`file`) is a plain link, never an Inertia visit: `'download'` for a file the server sends as an attachment (a Supplier Invoice's original), with the `download` attribute and no new tab, `'view'` for one the browser shows (a Quote's PDF), in a new tab. The Job's are in `app/services/job_actions.ts`, the Customer's and the Site's beside them. Archiving a record counts as destructive.
- **Hidden or disabled.** An action the state makes meaningless is hidden (no new Visit on a closed Job). The primary is the exception: it stays, disabled with its reason shown beside it, since the user looks for it there (the Job's draft Invoice when nothing is to bill, or a draft already waits). Use `disabledReason` elsewhere only where a user would otherwise search for a missing action. The page may add one itself for its own unsaved edits, the one state the server can't see (the Quote's sending and answers wait for Save). A draft whose next step can't be undone keeps that step as its primary and Save as a secondary beside it (a draft Invoice: Emetti, then Salva bozza), the step disabled while edits wait for Save.
- **Header or section.** The header holds the record's own actions. Adding to a section ("Aggiungi addebito") sits in that section's header, and acting on one row in its row; the server still decides whether they show (through the page's props).
- **Confirmations** use the confirmation dialog (`confirm_dialog.vue`), never `window.confirm`: titled with the action, the question as its text, the action's own label on its button.
- **Deleting through a `DELETE` route** is a `post` action with `method: 'delete'`, destructive with its `confirm` question like any other: the screen asks it in the confirmation dialog, then sends the `DELETE` (the Item's Elimina, `app/services/item_actions.ts`). Deleting one row of a section still uses the row's own button and the confirmation dialog.

## Entity screen body

- **The same on every Entity:** a key-facts band of 3–4 facts under the header (desktop: one row; phone: a two-column grid), then sections.
- **Facts line or key facts.** The header's line names the record: its number, its kind, the dates of its state ("2026/0005 · Riparazione · aperta il 20/10/2026"), as plain text. The key-facts band holds what the user acts on: who and where (linked to their pages) and the money, each value with an optional hint ("su 2.388,00 € registrati").
- **Frozen records read as text.** Once a record can't change (an issued Invoice), its lines show their values as text in the fields' places, not as disabled fields.
- **Bespoke per Entity:** which facts and sections. The section holding the screen's main work takes the main column on desktop; supporting sections take the side column. On the phone everything stacks, and a section's table becomes a list of rows.

## Lists

Plain until the lists design session (#237), which decides filters, sorting and row actions; until then `CODING_STANDARDS.md` "Lists" holds (#238).

- **A top-level screen:** no parent, so the desktop breadcrumb is the list alone and the phone's bar shows the logo, not "‹". Creating a record ("Nuovo …") is the primary action; the list's other pages (its archived records, a Legacy Invoice) are secondary links (`listActions()`, `app/services/list_actions.ts`).
- **Body** (`list_screen.vue`): the list's search and filters, where it has them, then its records in a bordered box, then the pages. A table on tablet and desktop (a wide one scrolls inside its box, never the page) and a list of rows on the phone, each row opening its record: the record's link stretches over the whole row (`OPENS_ROW`, `OPENS_LINK`). Statuses in tags, with the record's tones (`screen.ts`).

## Settings

The settings area (Impostazioni) is one menu item; its pages are tabs under each page's header (`SettingsScreen`), the current one marked by a red line. The company's details are its home, which the menu opens: the other pages sit under it in the breadcrumb.

- **A form page** (the company, the VAT rules) is in edit mode: Save is its primary action.
- **A list edited in place** (rates, VAT Codes, Payment Terms, Categories): each row is a short form with its own Save, its errors after its fields, each naming its field (#226); the row's other action (archive, delete) beside it, always confirmed: neither can be undone. On the phone a row's fields stack, each with its name; on desktop column heads name them once. Adding one is the section's action, opening a dialog.
- **Several short forms** (Numerazione fatture: each year's next number, the Credit Notes' numbering, the SDI files' letter; Istanza): each in its section, with its own Save beside its field or under its fields; the header has no actions.
- **A page under a tab** (a Document Template's editor, and its "Prova con dati reali"): an Entity screen without the tabs, under its tab in the breadcrumb (Impostazioni › Modelli di documento › the template). A record's editor there is always in edit mode and is the record's only page, so its own actions sit beside Save ("Kinds of screen").
- **Utenti and Istanza** are their own menu items in the Impostazioni group, not tabs: Utenti for the Admin, Istanza for the Superuser, each a screen with no parent, so on the phone the bar shows the logo instead of "‹", as Giacenze does. On Utenti, deactivating and reactivating an account (each row's action) are confirmed, the question naming the person: one locks them out, the other lets them back in.

## Menu

- **Desktop:** the black sidebar, grouped by area (Lavoro, Fatturazione, Magazzino, Anagrafiche, Impostazioni at the end), showing only what the role can open. The active item is marked with the red cut.
- **Phone:** the same sidebar, as a drawer from the right, opened by "☰". Same groups, same items, plus search and the user at the bottom.
- A Technician's menu is short: I miei interventi. Whether Technicians also get an Agenda (read-only) or a screen for today is still to be decided.

## Hierarchy and references

- **One canonical place.** Every screen has one parent, whatever route reached it: an Item sits under Articoli, a Visit under its Job (under I miei interventi for a Technician, who can't open Jobs). The desktop breadcrumb shows that path.
- **Back on the phone** goes to the previous screen when it was inside the app, otherwise to the canonical parent; its label says which. For now it always goes to the canonical parent (the breadcrumb's last step), which the screen header hands to the shell's bar (`docs/follow-ups.md`).
- **Preview or page.** A record referenced from lines or Charges inside another record (an Item in a Visit's Charges, a line on an Invoice) opens a preview: a bottom sheet on the phone, a side panel on desktop, with "Apri scheda" for its page. Every other link opens the page.
- **A preview** (`record_preview.vue`, #236) shows the record's name as on its page (its kind above, its code and the like under), two or four facts in a two-column grid, then "Apri scheda" and "Chiudi". The side panel starts at 768px (tablet and desktop) and is full height on the right. It is modal: focus stays inside, Esc closes it, and focus goes back to the row that opened it. Its data comes as JSON from the record's `…/:id/preview` route, beside its page and open to the same roles; the screen sends the record's id on the row only when the user may open it, and the row's name is then a button. The Item's is `item_preview.vue`, opened from a Job's Charges, a Quote's lines and a Supplier Invoice's lines; on an editable line the row's kind ("Articolo") is the button, since its name is a field.
- **Dialogs** only for short, focused tasks: a confirmation, a small form ("+ Ore"), moving a Visit with a preview. Never a whole record.

## Look

- **Colours** are CSS variables, light and dark; the system setting decides, the user can override. Black and white for controls and text; status colours (blue planned, orange in progress or to bill, green done or paid, grey draft) in tinted tags, never colour alone.
- **Brand red** is a mark only: the logo cut, the active menu item, the focus ring. Errors use red too, always with an icon and words.
- **Type:** Inter with tabular figures for text and numbers; Montserrat for the wordmark and section labels (spaced capitals). Status tags in sentence case. Fonts are self-hosted.
- **Shape:** 3px corners, flat bordered surfaces; shadows only on what floats (menus, sheets, dialogs, toasts). Touch targets at least 44px.
- **Density:** compact on desktop, roomier on touch screens; the same components, spaced by screen size.
