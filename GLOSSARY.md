# Maso Gestionale

Management app for a single small plumbing business: customers, jobs and visits, stock, invoicing and compliance documents. Canonical terms are English and used in code; the interface shows the Italian equivalent noted next to each term (ADR 0006).

## Customers and installations

**Customer** (_Cliente_):
The person or organization that is billed for work.
_Avoid_: Client, account

**Site** (_Immobile_):
A physical address where work is done and equipment is installed, independent of who owns or pays for it.
_Avoid_: Location, address, property

**Installed Equipment** (_Apparecchio_):
A specific piece of equipment (boiler, AC unit, water heater…) installed at a Site, which outlives changes of Customer and may refer to the Item it was sold as.
_Avoid_: Product, asset, impianto (when meaning a single unit), installation

**Maintenance Interval** (_Intervallo di manutenzione_):
How often a piece of Installed Equipment needs a periodic check, from which its next due date follows.
_Avoid_: Service schedule, recurrence

## Work

**Job** (_Commessa_):
A whole piece of work for a Customer, which may span multiple Visits, may be quoted, and is invoiced from its Charges. When a Job is cancelled its Visits are kept as history: they leave the Agenda and the Technicians' lists and accept no further work.
_Avoid_: Intervention, work order, ticket, Quoted Job / Time & Materials Job (a Job has no kind; it may have a Quote)

**Work Category** (_Tipo di lavoro_):
The kind of work a Job is (new installation, maintenance, renovation, repair or sale), which together with the Customer and the Site decides the VAT normally charged.
_Avoid_: Job type, intervention type

**Quote** (_Preventivo_):
A priced proposal for a Job, or part of one, that the Customer accepts or declines; a Job can have several, written at any time. Once sent it no longer changes. It is never billed itself and doesn't bind the final bill; its lines can be imported onto the Job or its Visits as Charges.
_Avoid_: Estimate, offer

**Visit** (_Intervento_):
A single scheduled trip by one or more technicians to a Site as part of a Job.
_Avoid_: Intervention, appointment, call-out

**Survey** (_Sopralluogo_):
A Visit to see the Site before quoting or starting work; it doesn't start the Job's work.
_Avoid_: Inspection, preliminary visit

**Labour Rate**:
An hourly price for a type of labour; hours recorded on a Visit at a Labour Rate become a Charge at that price.
_Avoid_: Hourly cost, manodopera (as a price)

**Charge** (_Addebito_):
Something done or supplied for a Job that the Customer may be billed for (hours worked, an Item used, a call-out, any other cost), recorded on a Visit or on the Job and priced when recorded. Office decides whether, and at what price, it is billed.
_Avoid_: Billable item (clashes with Item), billable entry

**Call-out Fee** (_Diritto di chiamata_):
A fixed price for attending a Visit, independent of hours worked, billed as a Charge.
_Avoid_: Travel fee, uscita

## Stock

**Warehouse** (_Magazzino_):
The single place where the business holds stock.
_Avoid_: Inventory, depot

**Item** (_Articolo_):
A stocked article with a purchase price and an independently set resale price, which can be added to an invoice.
_Avoid_: Product, part, material

**Significant Good** (_Bene significativo_):
An Item of a kind listed by law (boilers, air conditioners, sanitaryware, window frames…) whose reduced VAT on residential maintenance only covers part of its value.
_Avoid_: Major item, main component

**Category** (_Categoria_):
A grouping of Items that carries a suggested markup, used only to propose a resale price.
_Avoid_: Family, type, group

**Item Document**:
A reference file attached to an Item, such as a manual or datasheet.
_Avoid_: Attachment, Issued Document

**Stock Movement** (_Movimento di magazzino_):
A recorded change to an Item's quantity in the Warehouse: a receipt (_carico_), usage on a Visit (_utilizzo_), a direct sale on an Invoice (_vendita_), or an adjustment with a reason (_rettifica_).
_Avoid_: Transaction, stock change, scarico (ambiguous between usage, sale and adjustment)

## Invoicing

**Invoice** (_Fattura_):
A request for payment to a Customer, which becomes a fiscal document with a number only once finalised.
_Avoid_: Bill, receipt

**VAT Code** (_Codice IVA_):
The VAT treatment of an invoice line: a rate, or no VAT together with the reason (exempt, out of scope, reverse charge) the tax agency requires.
_Avoid_: VAT rate (a code at 0% has no meaningful rate), aliquota (when meaning the whole treatment)

**Finalised Invoice**:
An Invoice that has received its number and date and can no longer be edited, except after a Rejection.
_Avoid_: Issued invoice, confirmed invoice

**Submission**:
The sending of a Finalised Invoice to SDI, either through the intermediary or as a manually confirmed upload of its XML.
_Avoid_: Upload, transmission, export

**SDI Notice** (_Notifica SDI_):
SDI's answer to a Submission (delivered, not deliverable, or rejected), dated and carrying SDI's identifier for the file; a Rejection's resubmission deadline counts from its date.
_Avoid_: Receipt, response

**Rejection** (_Scarto_):
SDI's refusal of a Submission; the invoice keeps its number and date and becomes editable for resubmission.
_Avoid_: Error, failure

**Credit Note** (_Nota di credito_):
A fiscal document linked to an Invoice that reduces or cancels it after delivery.
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
An amount received against an Invoice or Legacy Invoice; an invoice may have several.
_Avoid_: Receipt, transaction

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
