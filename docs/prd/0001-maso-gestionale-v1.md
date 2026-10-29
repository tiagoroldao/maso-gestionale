---
title: 'PRD: Maso Gestionale v1'
labels: [ready-for-agent]
---

> **Historical snapshot.** This PRD is kept as written when v1 was planned. Where a later decision changed it, the passage is marked and the ADR in `docs/adr/` is what holds: notably ADR 0012 (#130), under which a Job has no kind (Quoted or Time & Materials), may have a Quote, and always invoices from its Charges.

## Problem Statement

A small Italian plumbing business (around 10 people) runs its work across disconnected tools. Customer details, scheduling, stock, invoicing and paperwork live in different places, or on paper and in the owner's head. As a result:

- Office staff re-type the same Customer, Site and material data into invoices, quotes and compliance paperwork.
- Nobody can easily see which Jobs are in progress, which Visits are scheduled, what has been invoiced against a Job and what is still owed.
- Stock levels and purchase vs. resale prices aren't reliable, so materials used on site are under-billed or forgotten.
- Electronic invoicing through SDI is mandatory and unforgiving: sequential numbering, rejections and resubmission windows, Credit Notes. Tracking it by hand risks fiscal errors.
- Commonly formatted documents (such as compliance declarations) are rebuilt by hand for each Customer and Installed Equipment.
- The existing custom accounting software is being retired, but its invoices (some for ongoing Jobs that are already partly invoiced) must stay visible and payable.

Each business wants to own and run the system on hardware it already has, not rent a cloud service.

## Solution

A single web app per business ("Instance"), self-hosted on the business's own server and reachable by Technicians through a Cloudflare Tunnel with Cloudflare Access. It connects:

- **Customers, Sites and Installed Equipment.** Who pays, where the work happens, and what is installed there, kept separate so equipment history survives a change of Customer.
- **Jobs and Visits.** A Job is the unit that gets quoted and invoiced. Visits are the scheduled trips by Technicians that record hours and Items used.
- **Items and the Warehouse.** Purchase and resale prices, Categories that suggest a markup, Item Documents (manuals and datasheets), and a ledger of Stock Movements.
- **Invoicing.** Draft invoices built from a Job (from its Quote or from time and materials; _Superseded by ADR 0012_: every Job invoices from its Charges), percentage discounts, VAT codes per line, Advance Invoices deducted from the final invoice, Credit Notes, and Payments. Invoices are numbered only when finalised. Each Submission to SDI is tracked, whether done by hand (export the XML, confirm the upload, record the outcome) or, later, automatically through Invoicetronic (_Superseded by ADR 0019_: Openapi).
- **Legacy Invoices.** Imported as totals plus the original PDF. They can be linked to Customers and Jobs and paid off within the app.
- **Document Templates.** Edited in the app by the Admin inside a fixed Base Layout, using placeholder chips and typed fields (including entity choices). They produce numbered, frozen Issued Documents as PDFs.
- **Roles.** Superuser (Instance settings only), Admin (everything to do with the business, including company settings), Office, and Technician (their own Visits only, never prices).

## User Stories

### Customers, Sites and Installed Equipment

1. As an Office user, I want to create a Customer with their tax details (tax code and/or VAT number, SDI code or PEC), so that invoices to them can be sent through SDI.
2. As an Office user, I want to set a Customer's type (private individual, company, condominium, association or other body), so that sensible VAT and invoicing defaults are applied.
3. As an Office user, I want to set Payment Terms on a Customer, so that due dates on their invoices are calculated automatically.
4. As an Office user, I want to search Customers by name, tax code or VAT number, so that I can find them quickly on the phone.
5. As an Office user, I want to create Sites independently of Customers, so that one address can be served for different Customers over time.
6. As an Office user, I want a Customer's associated Sites listed first when picking a Site, while still being able to search all Sites, so that work done for a Customer at someone else's address is easy to record.
7. As an Office user, I want to record Installed Equipment at a Site (make, model, serial number, install date), so that the equipment's history stays with the place it is installed.
8. As an Office user, I want Installed Equipment to optionally link to the Item it was sold as, so that its manuals and default Maintenance Interval come from that Item.
9. As an Office user, I want to record Installed Equipment the business didn't sell, using free-text make and model, so that existing equipment at a new Customer's home can be tracked.
10. As an Office user, I want to set a Maintenance Interval on Installed Equipment, so that its next due check is known.
11. As an Office user, I want to see a Site's full history (Jobs, Visits, Installed Equipment, Issued Documents), so that I can answer questions about previous work.
12. As an Office user, I want to see a Customer's full history (Jobs, Invoices, Legacy Invoices, Payments, outstanding balance), so that I can handle billing questions.

### Items and Warehouse

13. As an Office user, I want to create an Item with code, description, unit of measure, Category, supplier, supplier product code, default VAT rate, purchase price and resale price, so that it can be stocked and invoiced.
14. As an Office user, I want the resale price suggested from the Category's markup when I create an Item, while still being set as its own value, so that pricing is quick but under my control.
15. As an Office user, I want the resale price never to change automatically, so that prices don't move without anyone noticing.
16. As an Office user, I want an Item flagged for review when a new purchase price would push its margin below the Category's markup, so that stale prices are caught.
17. As an Office user, I want the purchase price to be the most recent purchase price, so that it reflects what restocking costs.
18. As an Office user, I want to attach Item Documents (manuals, datasheets) to an Item, so that they are available to staff and on linked Installed Equipment.
19. As an Office user, I want to record a goods receipt that increases stock and updates the purchase price, so that incoming stock is tracked before Supplier Invoice import exists.
20. As an Office user, I want to record stock adjustments with a mandatory reason (stocktake, breakage), so that discrepancies can be explained.
21. As an Office user, I want to see each Item's current stock and its full Stock Movement history, so that I can trust and audit the numbers.
22. As an Office user, I want stock allowed to go negative with a warning, so that work in the field is never blocked by missing paperwork.
23. As an Office user, I want to see a list of Items with negative or low stock, so that I know what to reorder.
24. As an Office user, I want to create and manage Categories with a suggested markup, so that pricing suggestions match the business's habits.

### Jobs, Quotes and Visits

25. As an Office user, I want to create a Job for a Customer, optionally tied to a Site, so that a piece of work can be tracked from start to finish.
26. As an Office user, I want to choose whether a Job is a Quoted Job or a Time & Materials Job, so that it is invoiced the right way. _Superseded by ADR 0012_: a Job has no kind; it may have a Quote.
27. As an Office user, I want to write a Quote for a Job, with Items, Labour Rates, Call-out Fee and free-text lines, so that the Customer can approve the price.
28. As an Office user, I want to mark a Quote as accepted or declined, so that the Job moves on or is closed.
29. As an Office user, I want a Job's status (Open, Quoted, Accepted, In Progress, Work Complete, Invoiced, Closed, Cancelled) shown everywhere, so that everyone knows where it stands.
30. As an Office user, I want Work Complete, Invoiced and Closed worked out from Visits, Invoices and Payments, so that the status never drifts from reality.
31. As an Office user, I want to cancel a Job, so that abandoned work stops showing up in active lists.
32. As an Office user, I want to schedule Visits for a Job on a calendar with one column per Technician, so that I can plan the week.
33. As an Office user, I want to assign one or more Technicians to a Visit, so that team jobs are represented.
34. As an Office user, I want to move a Visit quickly, seeing its new time before confirming, so that rescheduling is fast and safe (drag and drop dropped by ADR 0020).
35. As an Office user, I want a "to schedule" list of Visits marked "needs another visit", so that follow-ups aren't forgotten.
36. As a Technician, I want to see today's and upcoming Visits on my phone, so that I know where to go.
37. As a Technician, I want to open a Visit and see the Customer, Site address, Installed Equipment and Job notes, so that I arrive prepared.
38. As a Technician, I want to open the Item Documents and Issued Documents for the Site I'm visiting, so that I have manuals and previous certificates on hand.
39. As a Technician, I want to change a Visit's status (to do, in progress, done, needs another visit), so that the office knows what's happening.
40. As a Technician, I want to record my hours on a Visit, against the right Labour Rate, so that labour can be invoiced.
41. As a Technician, I want to record Items used on a Visit by searching the catalogue, so that materials are invoiced and taken off stock.
42. As a Technician, I want to mark a used Item as "installed", so that Installed Equipment is created or linked at the Site automatically.
43. As a Technician, I want to add notes and photos to a Visit, so that the office and future visits have context.
44. As a Technician, I never want to see purchase prices, margins or invoice totals, so that commercial information stays in the office.
45. As an Office user, I want Items used on a Visit taken off stock when the Visit is marked done, so that the Warehouse stays accurate.
46. As an Office user, I want to see a Job's running total of time and materials recorded so far, so that I can tell whether a Time & Materials Job is getting expensive. _Superseded by ADR 0012_: shown for every Job.

### Invoicing

47. As an Office user, I want to create a draft Invoice from a Quoted Job, pre-filled from the accepted Quote, so that I don't re-type it. _Superseded by ADR 0012_: a Quote is never billable; its lines can be imported as Charges.
48. As an Office user, I want to create a draft Invoice from a Time & Materials Job, pre-filled from the hours and Items recorded on its Visits, so that nothing gets lost. _Superseded by ADR 0012_: this is how every Job invoices.
49. As an Office user, I want to create an Invoice without a Job (for example selling Items over the counter), so that direct sales are possible.
50. As an Office user, I want Items invoiced without a Visit taken off stock when the Invoice is finalised, so that direct sales keep stock correct.
51. As an Office user, I want to edit any line of a draft Invoice (description, quantity, price, line discount, VAT code), so that I can correct before issuing.
52. As an Office user, I want each line's VAT code to default from the Customer type, the Job's Work Category, the Site and the line kind while staying editable, so that the 10% rate on residential maintenance, reverse charge (_inversione contabile_) and similar cases are handled.
53. As an Office user, I want to apply a percentage discount to the whole Invoice, so that I can give a global discount.
54. As an Office user, I want the global discount applied before VAT and split across VAT rates in proportion, so that the FatturaPA totals stay correct.
55. As an Office user, I want to issue Advance Invoices for part of a Job, so that I can bill deposits and progress payments.
56. As an Office user, I want the final Invoice of a Job to include one deduction line per earlier Invoice or Legacy Invoice on that Job, so that the Customer isn't billed twice.
57. As an Office user, I want each Job to show "invoiced so far" against the Quote total or the recorded time and materials, so that I know what is left to invoice. _Superseded by ADR 0012_: invoiced so far is against the recorded work; the Quote total is shown only for comparison.
58. As an Office user, I want to delete a draft Invoice, so that mistakes don't use up a number.
59. As an Office user, I want to finalise an Invoice, giving it the next number and the date and locking it, so that it becomes a fiscal document.
60. As an Office user, I want a warning when I finalise Invoices while other Finalised Invoices haven't been submitted yet, so that I don't forget to send them.
61. As an Office user, I want a Finalised Invoice to produce its FatturaPA XML and PDF, so that it can be sent and printed.
62. As an Office user, in manual SDI mode, I want to download an Invoice's XML and then confirm "I uploaded this", so that each Submission is recorded.
63. As an Office user, in manual SDI mode, I want to record the outcome (Delivered, Not deliverable, Rejected), so that each Invoice's SDI status is known.
64. As an Office user, I want a Rejected Invoice to become editable again with the same number and date, so that I can fix and resubmit it as the rules allow.
65. As an Office user, I want a warning showing how long remains of the 5-day resubmission window after a Rejection, so that I resubmit in time.
66. As an Office user, I want a list of Invoices by stage (Draft, Finalised and not submitted, Submitted with no outcome, Rejected), so that nothing gets stuck.
67. As an Office user, I want to issue a Credit Note linked to a delivered Invoice, through the same lifecycle, so that I can correct invoices that can no longer be changed.
68. As an Office user, I want to download an Invoice's PDF (on the Base Layout) at any time, so that I can print it or hand it over.

### Payments

69. As an Office user, I want to record one or more Payments against an Invoice or Legacy Invoice, so that part-payments and deposits are tracked.
70. As an Office user, I want payment status (unpaid, partly paid, paid, overdue) worked out from Payments and the due date, so that it is always right.
71. As an Office user, I want a list of overdue Invoices and Legacy Invoices, so that I can chase Customers.
72. As an Admin, I want to see outstanding balances by Customer, so that I know who owes what.

### Legacy Invoices and switch-over

73. As an Office user, I want to import Legacy Invoices with number, date, Customer, taxable total, VAT total, grand total and the original PDF, so that history from the old software is available.
74. As an Office user, I want to link a Legacy Invoice to a Job, so that ongoing Jobs with earlier partial invoices are accounted for correctly.
75. As an Office user, I want Legacy Invoices to show their payment status and accept Payments, so that old unpaid invoices can still be collected.
76. As an Office user, I want Legacy Invoices included in Customer history and balances, so that reports are complete.
77. As an Office user, I want Legacy Invoices never to enter the SDI flow, so that they can't be sent twice.
78. As an Office user, I want to bulk-import Customers and Items from the old system, so that the switch-over doesn't mean re-typing everything.

### Document Templates and Issued Documents

79. As an Admin, I want to create a Document Template by writing its body in a rich-text editor inside a fixed Base Layout (company and Customer header), so that common documents look consistent.
80. As an Admin, I want to insert data as placeholder chips (for example Site › Address or Equipment › Serial number) rather than typed syntax, so that templates can't break.
81. As an Admin, I want to add typed fields to a template (text, long text, number, date, yes/no, fixed list, repeating table), each optionally required, so that the right information is asked for when a document is generated.
82. As an Admin, I want to add entity fields (Site, Installed Equipment, one or more Items, Job), so that documents can include chosen records, such as a list of Items or a particular address.
83. As an Admin, I want a live preview of a template filled in with sample data, so that I can see the result while editing.
84. As an Admin, I want every save of a template to create a new version, so that past Issued Documents keep the wording they were issued with.
85. As an Office user, I want to generate a document for a Customer by picking a template and filling in its fields, so that paperwork takes minutes.
86. As an Office user, I want Installed Equipment choices limited to the chosen Site, and Item fields to offer "load from Job", so that filling in the fields is quick and consistent.
87. As an Office user, I want an Issued Document to receive the next yearly number for its template and to copy in all the data used, so that it never changes afterwards.
88. As an Office user, I want to issue a replacement for an Issued Document, with the original marked as replaced, so that corrections are traceable.
89. As an Office user, I want to download an Issued Document as a PDF, so that I can print it or hand it over.
90. As an Office user, I want Issued Documents shown in the history of the Customer, Site and Installed Equipment, so that I can find them later.

### Settings, roles and Instance management

91. As an Admin, I want to edit company details (name, VAT number, tax code, address, logo, tax regime, IBAN) live in the app, so that the Base Layout and FatturaPA XML are always correct.
92. As an Admin, I want to manage Labour Rates, the Call-out Fee, Categories, Payment Terms and VAT defaults, so that the app reflects how the business charges.
93. As an Admin, I want to set the starting number per sequence for each year, locked once the first invoice in that sequence is finalised, so that the switch-over keeps numbering continuous and safe.
94. As an Admin, I want to create and deactivate Office and Technician accounts, so that I control who has access.
95. As a Superuser, I want to set the SDI mode (manual or Invoicetronic) and its credentials, so that the Instance can submit invoices.
96. As a Superuser, I want to configure the polling schedule and an optional webhook, so that SDI outcomes and Supplier Invoices arrive reliably.
97. As a Superuser, I want to configure the off-site backup target and encryption key, and see when the last backup succeeded, so that the business's data is safe.
98. As a Superuser, I want to set the Instance's public URL, so that links and the tunnel line up.
99. As a Superuser, I want to recover an Admin account, so that a business locked out of its own system can get back in.
100.  As a Superuser, I want to apply an update by hand, with an automatic backup taken first and database migrations run, so that updates are safe and happen when I choose.
101.  As a Superuser, I don't want access to business data unless the Admin gives me a business role, so that GDPR roles stay clear.
102.  As a Superuser, I want a first-run setup that creates the first Admin, so that a new Instance can be handed over to a business.

## Implementation Decisions

**Architecture** (see ADRs 0001–0005)

- A single AdonisJS (TypeScript) application rendering Vue pages through Inertia. Postgres for data. Gotenberg for HTML→PDF. Deployed with Docker Compose on one on-prem machine together with `cloudflared` and a backup job.
- One business per Instance. No multi-tenancy. Everything company-specific is a setting.
- Online only. The Technician screens are responsive pages in the same app; there is no offline mode.
- Releases ship as versioned Docker images. Updates are applied by hand by the Superuser, with a backup first and migrations after.

**Modules**

- **Parties**: Customer, Site, Installed Equipment, Maintenance Interval. Installed Equipment refers to a Site and, optionally, an Item.
- **Catalogue & Stock**: Item, Category, Item Document, Stock Movement. Stock is a ledger: current quantity is the sum of Stock Movements, never a column edited directly. Movement types are receipt, usage on a Visit (when the Visit is marked done), direct sale (when the Invoice is finalised), and adjustment (reason required). Negative balances are allowed. The purchase price is updated from the latest receipt. The resale price is changed only by a person. A "margin below Category markup" flag is calculated.
- **Work**: Job (kind: Quoted or Time & Materials; _Superseded by ADR 0012_: a Job has no kind, and Quoted and Accepted apply only to a Job with a Quote), Quote, Visit, Visit hours (per Technician, per Labour Rate), Visit Items. Job status is stored only for Open, Quoted, Accepted, In Progress and Cancelled. Work Complete, Invoiced and Closed are worked out by a single Job status function from Visits, Invoices and Payments.
- **Invoicing**: Invoice, Credit Note, Advance Invoice (an Invoice whose role is advance), Invoice lines, Legacy Invoice, Payment, Payment Terms, numbering sequences. Contains:
  - An **Invoice totals** module (a deep, pure function): lines + line discounts + global percentage discount + VAT codes → per-rate taxable amount and VAT summary, plus grand total. The global discount is applied before VAT and split across rates in proportion to each rate's taxable amount, with rounding consistent with the FatturaPA rules. Advance deductions are negative lines produced from earlier Invoices and Legacy Invoices on the Job.
  - An **Invoice lifecycle** module (a state machine): Draft → Finalised → Submitted → Delivered | Not deliverable | Rejected, with Rejected → (edit) → Submitted again. Finalising takes the next number in a sequence and the date in one transaction, and makes the document unchangeable. Rejected allows edits but keeps its number and date. Credit Notes use the same machine and, for now, the invoice sequence.
  - A **FatturaPA XML builder**: a pure function from a Finalised Invoice or Credit Note (plus company settings and Customer) to XML conforming to the FPR12 schema (no FPA12 public-sector format in v1).
  - **Numbering sequences** per year. The Admin sets the starting number, which locks once the sequence's first document of that year is finalised.
- **SDI**: an `SdiGateway` interface with two implementations. _Manual_: XML download, confirming the upload, recording the outcome by hand. _Invoicetronic_: added later (_Superseded by ADR 0019_: Openapi, which also receives Supplier Invoices). Scheduled polling is the source of truth for outcomes. A webhook, if enabled, only triggers an immediate poll. Every Submission and outcome is stored as a history entry on the Invoice.
- **Documents**: Base Layout (fixed, in code), Document Template (versioned), template fields, Issued Document. A template is one Customer plus an ordered list of fields. Field types: text, long text, number, date, yes/no, fixed list, repeating table, and the entity fields Site, Installed Equipment, Item (one or many) and Job. The body is TipTap rich-text JSON with placeholder chips. An Issued Document stores the template version, a snapshot of every value used (entity data copied, not referenced), its yearly number per template, the rendered PDF, and an optional reference to the Issued Document it replaces.
- **Rendering**: a `DocumentRenderer` interface that renders HTML (Base Layout + body) and converts it to PDF through Gotenberg. Invoice PDFs are fixed templates in code on the same Base Layout.
- **Access**: roles Superuser, Admin, Office, Technician, enforced through AdonisJS policies. Technicians see only their assigned Visits and never price, cost or total fields. These are removed on the server, not just hidden in Vue. The Superuser sees only Instance settings.
- **Settings**: Instance settings (Superuser) and company settings (Admin), stored in the database and editable live. The split is listed in ADR 0005.
- **Import**: a one-off import of Customers, Items and Legacy Invoices (with PDFs) from the old accounting software. The format will be decided once an export is available.

## Testing Decisions

- Good tests check behaviour you can see from outside (HTTP responses, Inertia props, database state, generated XML and HTML), never how it's implemented internally. Refactoring a module's internals shouldn't break its tests.
- **Main seam: HTTP feature tests** with the Japa API client against a real Postgres test database, one suite per module, covering the user stories above, including role restrictions (for example, Technician responses must not contain price fields).
- **Domain modules tested directly through their public interface**: Invoice totals (VAT grouping, proportional percentage discount, rounding, advance deductions), the Invoice lifecycle (valid and invalid transitions, numbering with no gaps or duplicates under concurrent finalising, Rejection keeping its number, locking the starting number), the FatturaPA XML builder (validated against the official XSD, plus fixtures for 22%, 10%, reverse charge and multi-rate invoices with a discount), Job status derivation, and the Stock ledger.
- **SdiGateway**: an in-memory fake used by every other test. A contract test against the Invoicetronic sandbox is tagged and excluded from the default run.
- **DocumentRenderer**: template rendering checked at the HTML level (placeholder substitution, entity snapshots, repeating tables). One smoke test runs real Gotenberg in Docker and checks that a PDF comes out.
- **Browser E2E (Playwright)**: a small suite for the critical flows only: a Technician completing a Visit on a phone-sized screen (hours, Items, "installed"), and an Office user going from a Job to a draft Invoice to finalising it and downloading its XML.
- Prior art: none. The repository has no code yet, so these suites set the conventions.

## Out of Scope

- Automatic SDI Submission through Invoicetronic (the interface is designed now; the implementation comes later).
- Importing Supplier Invoices from SDI.
- The list of upcoming maintenance checks driven by Maintenance Intervals (the data is captured in v1; the list comes later).
- Attachments on Issued Documents and the company document library.
- Work Reports (_Rapportino_) and Customer signatures.
- Emailing anything to Customers.
- Public-sector invoicing (FPA12, CIG/CUP, split payment).
- Vans as stock locations; customer-specific price lists.
- Offline use.
- Legal archiving (_conservazione a norma_): handled outside the app through the Agenzia delle Entrate's free service.
- Multi-tenancy.
- Foreign Customers (non-Italian addresses, VAT numbers or `XXXXXXX` recipient code).

## Further Notes

- Until the app is feature-complete the UI is functional scaffolding for exercising and testing the backend; styles, navigation, listing conventions, filters and reports are designed in a dedicated UX pass before day-to-day use (ADR 0009). UX work found meanwhile is labelled `ui-later`.
- **Deadline**: invoicing and the Legacy Invoice import must be in production before the 1 January cutover, so that invoice numbering starts cleanly.
- **Build order**:
  1. Parties + Catalogue & Stock.
  2. Work and scheduling, with the Technician screens.
  3. Invoicing, Payments and Legacy import.
  4. Document Templates.
- VAT Codes and the default VAT rules are Admin-editable settings, seeded with our reading of the law and reviewed by the business's _commercialista_ (#17) without blocking invoicing (ADR 0008). Mechanisms not yet needed are proposals (#56–#61).
- Glossary: `GLOSSARY.md`. Decisions: `docs/adr/`. Use glossary terms in code, UI and tests.
