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
A whole piece of work for a Customer, which may span multiple Visits and is the unit that gets quoted and invoiced.
_Avoid_: Intervention, work order, ticket

**Quoted Job**:
A Job invoiced from an accepted Quote.

**Time & Materials Job**:
A Job invoiced from the labour and Items recorded on its Visits.

**Quote** (_Preventivo_):
A priced proposal for a Job that the Customer accepts or declines.
_Avoid_: Estimate, offer

**Visit** (_Intervento_):
A single scheduled trip by one or more technicians to a Site as part of a Job.
_Avoid_: Intervention, appointment, call-out

**Labour Rate**:
An hourly price for a type of labour, billed per technician-hour recorded on a Visit.
_Avoid_: Hourly cost, manodopera (as a price)

**Call-out Fee** (_Diritto di chiamata_):
A fixed charge for attending a Visit, independent of hours worked.
_Avoid_: Travel fee, uscita

## Stock

**Warehouse** (_Magazzino_):
The single place where the business holds stock.
_Avoid_: Inventory, depot

**Item** (_Articolo_):
A stocked article with a purchase price and an independently set resale price, which can be added to an invoice.
_Avoid_: Product, part, material

**Category** (_Categoria_):
A grouping of Items that carries a suggested markup, used only to propose a resale price.
_Avoid_: Family, type, group

**Item Document**:
A reference file attached to an Item, such as a manual or datasheet.
_Avoid_: Attachment, Issued Document

**Stock Movement**:
A recorded change to an Item's quantity in the Warehouse: a receipt, usage on a Visit, a direct sale on an Invoice, or an adjustment with a reason.
_Avoid_: Transaction, stock change, carico/scarico

## Invoicing

**Invoice** (_Fattura_):
A request for payment to a Customer, which becomes a fiscal document with a number only once finalised.
_Avoid_: Bill, receipt

**Finalised Invoice**:
An Invoice that has received its number and date and can no longer be edited, except after a Rejection.
_Avoid_: Issued invoice, confirmed invoice

**Submission**:
The sending of a Finalised Invoice to SDI, either through the intermediary or as a manually confirmed upload of its XML.
_Avoid_: Upload, transmission, export

**Rejection** (_Scarto_):
SDI's refusal of a Submission; the invoice keeps its number and date and becomes editable for resubmission.
_Avoid_: Error, failure

**Credit Note** (_Nota di credito_):
A fiscal document linked to an Invoice that reduces or cancels it after delivery.
_Avoid_: Refund, correction invoice

**Advance Invoice** (_Fattura di acconto_):
An Invoice for part of a Job, deducted from the Job's final Invoice.
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
The field role that carries out assigned Visits and records hours, Items used and notes, without seeing purchase prices.
_Avoid_: Plumber, installer, operator
