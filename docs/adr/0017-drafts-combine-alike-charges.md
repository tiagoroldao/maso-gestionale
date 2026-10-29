# Invoice drafts combine alike Charges

A draft Invoice from a Job made one line per Charge, so a long Job gave 100+ lines and Office could only merge two adjacent lines at a time. Drafting now **combines** (_accorpa_) alike Charges, by default: hours of the same Labour Rate, and Charges of the same Groupable Item (#176), share a line when their billed unit price and VAT Code match. A combined line keeps a real quantity (the Charges' quantities added up) and the shared price, holds all its Charges, and is described by the Labour Rate or Item with the period of its Visits ("Manodopera idraulico (12 interventi, 03/11–28/11)"). Different prices stay on separate lines, next to each other. Nothing else combines: an Item that isn't Groupable (Equipment and significant goods, by default) gets a line per Charge, placed next to the others of the same Item, with the serial numbers of the equipment it installed ("Caldaia — matr. 12345"); Office's other costs get a line each. When drafting, Office can untick combining (one line per Charge, the full breakdown some Customers want) and give an "up to" day: only Visits whose work day is on or before it are billed, plus the Job's own Charges, for weekly or periodic billing. On a draft, "fold consumables" puts every line of a Groupable Item into one lump line, "Materiale di consumo", 1 × their total, per VAT treatment; it's Office's choice, never the default. Decided by the business on 2026-10-29 (#179).

Items that aren't Groupable keep a line each because a line is what a Credit Note credits: its Charges are credited only when the line is credited in full (ADR 0014). A boiler returned out of three on one line could only be credited in part, leaving all three billed; on lines of their own, the one returned is credited and its Charge with it. Its own line also names the piece by its serial number, which the Customer and the warranty need.

Combining applies within each section of an Invoice once Invoices have sections (#184); until then a draft has one section, the same as organising by none. When organised by Visit, each day's hours combine within that day only.

## Considered Options

- **One line per Charge, merged by hand** (until now): exact and simple, but unusable on long Jobs, and merging two lines at a time turns a line's quantity and price into 1 × the amount.
- **Combine everything alike, Equipment included:** fewer lines, but one returned piece could never be credited on its own, and serial numbers wouldn't fit one line.
- **Combine by description:** catches what Office renamed, but two workers' hours on one rate have different descriptions, and a renamed Charge would silently split from its kind.
- **Lump consumables by default:** what some invoices look like, but it hides the quantities a Customer may ask about; Office folds them when it suits.

## Consequences

- The rule lives in `shared/combined_lines.ts` (`combineCharges`, `consumableFolds`), so #184 applies it per section.
- Whether an Item is Groupable is read from the Item when drafting, not recorded on its Charges: changing the flag changes the next draft, never an existing one.
- Combined lines bill exactly their Charges: each Charge's billed amount is its share of the line (as for merged lines), and finalising, releasing and crediting work as before.
- A draft that leaves work out with "up to" doesn't bill everything outstanding, so it starts without taking advances back (ADR 0011).
- Folding a draft's consumables, like merging lines, is done on the page and saved with the lines; only lines billing Charges fold, so a sale's Item lines still take their Items off stock.
