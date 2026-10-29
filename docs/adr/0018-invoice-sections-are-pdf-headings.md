# Invoice sections are headings on the PDF, organised when drafting

**Amended by 0020** (2026-10-30): no drag and drop. Sections and their lines move with the up and down actions only, and an empty Section is a place to move lines to, not to drop them.

A long Job's Invoice is easier to read in parts: the labour, the materials, the equipment installed, or Visit by Visit. An Invoice's lines can now sit in **sections** (_sezioni_): one level of headings, each with a title and an option to show its subtotal (its lines' amounts added up, before VAT and the global discount). A line belongs to at most one section, and lines outside any sit at the top. Office renames, adds, removes and reorders sections and moves lines between them by drag and drop, with the up and down arrows kept for the keyboard and the phone; a line moved past the first or last of its section goes into the one before or after. Removing a section leaves its lines, outside any.

A draft from a Job is **organised** when it is made: by kind (Manodopera, Materiali, Apparecchi for Equipment Items, Altro), the default; by Visit (one section per Visit, "Intervento del 03/11", with its start time when two Visits share a day, "Intervento del 03/11 (14:00)", then "Commessa" for the Job's own Charges); by Item category (Manodopera, each category by name, then Altro); or not at all. Sections are made first, then alike Charges are combined within each one only (ADR 0017), so organised by Visit each Visit's hours combine within it. On a draft from a Job, Office can organise again: after a confirmation, the sections are replaced and lines Office added by hand stay, in "Altro" (after the others when not organised). A Credit Note starts with the sections of the Invoice it credits, and Office can change them. Sections are frozen with the rest of the Invoice when it is finalised, and corrected with it after a Rejection. Decided by the business on 2026-10-29 (#184).

Organising again redrafts the lines billing Charges from the Charges the draft holds, each at its line's VAT treatment (confirmed by the business on 2026-10-29, #184), so Office's changes to those lines (descriptions, prices, merges, folds) are lost; the page asks first and says so. Moving the existing lines instead can't work when a line combines several Visits' hours and the draft is organised by Visit (see Considered Options).

Sections exist on the PDF only. The FatturaPA XML has no place for a heading: a heading written as a line of zero would be a line SDI and the Customer's software read as goods or a service, and a subtotal written as a line would count twice. So the XML keeps its lines flat, and in the same order as the PDF: lines are numbered in section order whenever they are saved (outside any section first, then each section's in turn, then the deductions taking advances back, which follow every section without a heading). The PDF is a courtesy copy; the XML stays the fiscal original, and the two always list the same lines in the same order.

This is a new ADR rather than an addition to ADR 0017. Combining decides which Charges share a line, and a line is what a Credit Note credits (ADR 0014), so it has fiscal consequences; sections only frame lines on the courtesy copy, and change nothing that is billed or credited. The two meet in one place, the order in which drafting applies them, which both record.

## Considered Options

- **Headings in the XML** as descriptive lines at zero: visible in the Customer's software too, but lines without goods or a service confuse SDI checks and accounting imports, and the PDF and the XML would disagree on what a line is.
- **Sections as a list order only, with no record:** headings worked out on each PDF from the lines (by kind, by Visit). Nothing to store, but Office couldn't rename, merge or reorder them, and a finalised PDF would change if an Item's category changed later.
- **Nested sections:** a Visit inside a phase of work. More flexible, but harder to edit on a phone and not asked for; one level covers the cases the business described.
- **Organising again only moves lines:** keeps Office's edits, but a line combining several Visits' hours can't be split across Visit sections, so organising by Visit after combining by kind would be impossible.

## Consequences

- Sections are stored per Invoice (`invoice_sections`), with each line's `section_id`; they go with the Invoice, and a line whose section is removed stays.
- The rule lives in `shared/invoice_sections.ts`: `organiseCharges()` makes the sections a draft starts with, `inSectionOrder()` numbers lines as the server saves them and the page shows them, and `sectionRuns()` gives the PDF its headings and subtotals.
- "Fold consumables" (ADR 0017) folds within each section, and "merge up" only joins a line to the one above in the same section.
- Saving without sections (an older client) keeps the sections and the lines' places in them; a line added that way sits outside any section, at the top.
- A Credit Note's sections are its own copy: changing them never changes the credited Invoice's PDF.
- A section left without lines shows on the page, to drop lines into, but isn't printed.
