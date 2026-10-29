# Maso Gestionale

Management app for a single small plumbing business: customers, jobs and visits, stock, invoicing and compliance documents. Canonical terms are English and used in code; the interface shows the Italian equivalent noted next to each term (ADR 0006).

## Customers and installations

**Customer** (_Cliente_):
The person or organization that is billed for work.
_Avoid_: Client, account

**Customer type** (_Tipo di cliente_):
What a Customer is: a private individual (_Privato_), a company (_Azienda_), a condominium (_Condominio_) or another organisation such as an association (_Ente / associazione_). It decides the identifiers required (a private individual's 16-character Codice Fiscale, a company's VAT number, a condominium's or organisation's 11-digit Codice Fiscale), whether Invoices name the Customer by first and last name or by name, and, with the Work Category and the Site, the VAT normally charged.
_Avoid_: Customer kind, customer category

**Site** (_Immobile_):
A physical address where work is done and equipment is installed, independent of who owns or pays for it.
_Avoid_: Location, address, property

**Installed Equipment** (_Apparecchio_):
A specific piece of equipment (boiler, AC unit, water heater…) installed at a Site, which outlives changes of Customer and may refer to the Item it was sold as. Registered at the Site by hand, or when a Charge of an Equipment Item becomes done (one per piece); after that it is managed by hand, and a wrong one is deleted on the Site.
_Avoid_: Product, asset, impianto (when meaning a single unit), installation

**Maintenance Interval** (_Intervallo di manutenzione_):
How often a piece of Installed Equipment needs a periodic check, from which its next due date follows.
_Avoid_: Service schedule, recurrence

## Work

**Job** (_Commessa_):
A whole piece of work for a Customer, which may span multiple Visits, may have Quotes, and is invoiced from its Charges. When a Job is closed or cancelled its Visits are kept as history and accept no further work, while Office can still bill the Charges already recorded: they leave the Technicians' lists, and the Agenda too once the Job is cancelled (a closed Job's stay there, read-only).
_Avoid_: Intervention, work order, ticket, Quoted Job / Time & Materials Job (a Job has no kind; it may have several Quotes)

**Closed Job** (_Commessa chiusa_):
A Job Office has closed because its work is finished; it takes no new work but still records Payments and Credit Notes, and can be reopened.
_Avoid_: Completed job, archived job

**Work Category** (_Tipo di lavoro_):
The kind of work a Job is (new installation, maintenance, renovation, repair or sale), which together with the Customer and the Site decides the VAT normally charged.
_Avoid_: Job type, intervention type

**Quote** (_Preventivo_):
A priced proposal for a Job, or part of one, that the Customer accepts or declines; a Job can have several, written at any time. Once sent it no longer changes. It is never billed itself and doesn't bind the final bill; an accepted Quote's lines can be imported onto the Job or its Visits as Charges.
_Avoid_: Estimate, offer

**Visit** (_Intervento_):
A single scheduled trip by one or more technicians to a Site as part of a Job.
_Avoid_: Intervention, appointment, call-out

**Survey** (_Sopralluogo_):
A Visit to see the Site, typically before a Quote; it never moves its Job to in progress. A Visit that isn't a Survey is a work Visit.
_Avoid_: Inspection, preliminary visit

**Cancelled Visit** (_Intervento annullato_):
A Visit that didn't happen; it keeps its record, its Charges become not done, and it can be restored.
_Avoid_: Deleted visit

**Labour Rate**:
An hourly price for a type of labour; hours recorded on a Visit at a Labour Rate become a Charge at that price.
_Avoid_: Hourly cost, manodopera (as a price)

**Charge** (_Addebito_):
Something done or supplied for a Job that the Customer may be billed for (hours worked, an Item used, a call-out, any other cost), recorded on a Visit or on the Job and priced when recorded. Office decides whether, and at what price, it is billed.
_Avoid_: Billable item (clashes with Item), billable entry

**Work state** (_Stato di esecuzione_):
Whether a Charge happened: planned (_previsto_), done (_eseguito_) or not done (_non eseguito_). Stock follows it; only done Charges are billed.
_Avoid_: Status (ambiguous with billing)

**Call-out Fee** (_Diritto di chiamata_):
A fixed price for attending a Visit, independent of hours worked, billed as a Charge.
_Avoid_: Travel fee, uscita

## Stock

**Warehouse** (_Magazzino_):
The single place where the business holds stock.
_Avoid_: Inventory, depot

**Item** (_Articolo_):
A stocked article with a purchase price and an independently set resale price, which can be added to an invoice. An **Equipment** (_Apparecchio_) Item becomes Installed Equipment at the Site when its Charge is done; a **Groupable** (_Accorpabile_) Item's Charges are combined on one Invoice line with others of the same Item, price and VAT Code when a draft is made.
_Avoid_: Product, part, material

**Significant Good** (_Bene significativo_):
An Item of a kind listed by law (boilers, air conditioners, sanitaryware, window frames…) whose reduced VAT on residential maintenance only covers part of its value.
_Avoid_: Major item, main component

**Category** (_Categoria_):
A grouping of Items that carries a suggested markup, used to propose a resale price and, when Office chooses, to organise an Invoice's Sections.
_Avoid_: Family, type, group

**Item Document**:
A reference file attached to an Item, such as a manual or datasheet.
_Avoid_: Attachment, Issued Document

**Stock Movement** (_Movimento di magazzino_):
A recorded change to an Item's quantity in the Warehouse: a receipt (_carico_), usage on a Visit or the Job (_utilizzo_), a direct sale on an Invoice (_vendita_), or an adjustment with a reason (_rettifica_).
_Avoid_: Transaction, stock change, scarico (ambiguous between usage, sale and adjustment)

**Committed** (_Impegnato_):
The quantity of an Item on planned Charges of Jobs open or in progress: still in stock but spoken for. Available (_disponibile_) is in stock less committed; reorder alerts use it.
_Avoid_: Reserved, allocated

## Invoicing

**Invoice** (_Fattura_):
A request for payment to a Customer, which becomes a fiscal document with a number only once finalised.
_Avoid_: Bill, receipt

**Combined line** (_Riga accorpata_):
A draft Invoice line billing several alike Charges (hours of one Labour Rate, or one Groupable Item, at one price and VAT Code), with their quantities added up (ADR 0017). Drafting combines by default; "fold consumables" (_accorpa i materiali di consumo_) further lumps every Groupable Item line into one.
_Avoid_: Grouped line (groups are an Invoice's Sections), merged line

**Section** (_Sezione_):
A heading over some of an Invoice's or Credit Note's lines on its PDF, with its subtotal if Office chooses; one level only, and lines outside any sit at the top. A draft from a Job is organised into Sections by kind, by Visit or by Item category, or not at all; the FatturaPA XML has none, its lines flat in the same order (ADR 0018).
_Avoid_: Group, chapter, block

**VAT Code** (_Codice IVA_):
The VAT treatment of an Invoice or Quote line (and an Item's default): a rate, or no VAT together with the reason (exempt, out of scope, reverse charge) the tax agency requires.
_Avoid_: VAT rate (a code at 0% has no meaningful rate), aliquota (when meaning the whole treatment)

**Finalised Invoice**:
An Invoice that has received its number and date and can no longer be edited, except after a Rejection.
_Avoid_: Issued invoice, confirmed invoice

**Submission**:
The sending of a Finalised Invoice to SDI, either through the intermediary (Openapi, ADR 0019) or as a manually confirmed upload of its XML. Through the intermediary it is _sending_ until the intermediary has the file, and its SDI Notice arrives by polling.
_Avoid_: Upload, transmission, export

**SDI Notice** (_Notifica SDI_):
SDI's answer to a Submission (delivered, not deliverable, or rejected), dated and carrying SDI's identifier for the file; a Rejection's resubmission deadline counts from its date.
_Avoid_: Receipt, response

**Rejection** (_Scarto_):
SDI's refusal of a Submission; the invoice keeps its number and date and becomes editable for resubmission.
_Avoid_: Error, failure

**Credit Note** (_Nota di credito_):
A fiscal document that credits a delivered or not deliverable Invoice, partly or fully, reducing what is owed on it; an Invoice's Credit Notes together never exceed its total.
_Avoid_: Refund, correction invoice

**Advance Invoice** (_Fattura di acconto_):
An Invoice for part of a Job, billed up front and taken back, partly or fully, by the Job's later Invoices (usually its final one) as Office sets on each (ADR 0011).
_Avoid_: Deposit, partial invoice, SAL

**Supplier Invoice** (_Fattura passiva_):
An electronic invoice received from a supplier through SDI, used to record purchases of Items.
_Avoid_: Purchase invoice, incoming invoice

**Legacy Invoice**:
An invoice issued by the previous accounting software, kept only as its totals plus the original PDF, outside the SDI flow; it may belong to a Job.
_Avoid_: Old invoice, imported invoice, archived invoice

**Payment** (_Incasso_):
An amount received against an Invoice or Legacy Invoice, recorded as it happened; an invoice may have several. A refund is a negative Payment.
_Avoid_: Receipt, transaction

**Overpaid Invoice** (_Fattura pagata in eccesso_):
An Invoice whose Payments exceed what is owed on it after its Credit Notes; it needs someone to act.
_Avoid_: Credit balance

**Payment Terms** (_Condizioni di pagamento_):
The rule, set per Customer, that determines an invoice's due date.
_Avoid_: Due conditions

**SDI** (_Sistema di Interscambio_):
The Italian tax agency's system through which every electronic invoice is sent and received.

## Documents

**Base Layout**:
A fixed, non-editable page frame (company letterhead, Customer block) that every Document Template is rendered inside.
_Avoid_: Base template, master, letterhead template

**Recipient** (_Destinatario_):
Who a document is addressed to, printed in the Base Layout's header; usually taken from a Customer.
_Avoid_: Addressee, customer block

**Document Template**:
An Admin-editable definition of a document's body content and the extra fields it asks for, rendered inside a Base Layout.
_Avoid_: Form, model, certificate template

**Issued Document**:
A numbered, frozen PDF produced from a Document Template for one Customer, with all chosen data copied into it.
_Avoid_: Certificate, generated document, printout

**Work Report** (_Rapportino_):
An Issued Document giving a Job's closed Visits day by day (date, Technicians, hours per Labour Rate, Items used, and notes and prices if Office chooses), then the Job's other costs (its done Charges on no Visit) unless Office leaves them out, over the whole Job or a period; it comes from a Document Template with a work report field.
_Avoid_: Timesheet, Visit report

## People

**Instance** (_Istanza_):
One running copy of the system, owned and used by exactly one business.
_Avoid_: Installation, deployment, tenant

**Superuser**:
The role of whoever sets up and maintains an Instance, with access to Instance settings but not to business data.
_Avoid_: Root, sysadmin, super admin

**Admin** (_Titolare_):
The business owner role, with access to all business data and company settings.
_Avoid_: Amministratore (clashes with a condominium's amministratore, who is a Customer)

**Office** (_Ufficio_):
The staff role that manages Customers, Jobs, scheduling, invoicing and stock.
_Avoid_: Back-office, secretary

**Technician** (_Tecnico_):
The field role that carries out assigned Visits and records hours and Items used (as Charges) and notes, without seeing prices.
_Avoid_: Plumber, installer, operator
