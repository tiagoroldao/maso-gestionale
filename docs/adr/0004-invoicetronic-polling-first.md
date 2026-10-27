# Invoicetronic as SDI intermediary, polling as source of truth

Automatic SDI Submission goes through Invoicetronic. It accepts our own FatturaPA XML, has a free unlimited sandbox, transparent prepaid pricing (~€100 per 1,000 transactions), and signed webhooks plus polling endpoints. The app polls for outcomes and Supplier Invoices on a schedule. That is the source of truth, because an on-prem server may be offline and would miss webhooks. Webhooks, if enabled through the Cloudflare Tunnel, only trigger an immediate poll. All intermediary calls sit behind a single interface so that the provider can be swapped.

## Considered Options

- **Openapi**: equally capable, and it bundles *conservazione a norma* (~€105/yr total). Rejected in favour of Invoicetronic's developer experience.
- **Fatture in Cloud**: rejected; it does not accept externally generated XML.
- **A-Cube, Aruba**: technically capable, but pricing is not public and they target integrators.

## Consequences

- Invoicetronic offers no *conservazione a norma*, so legal archiving must be handled outside the app (e.g. the Agenzia delle Entrate free service).
