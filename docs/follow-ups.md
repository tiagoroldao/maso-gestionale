# Follow-ups

Work deliberately left for later: review findings not fixed in their PR, decisions deferred to a later issue, and known noise. Add an entry whenever something is postponed; remove it when it's done or dropped (with the reason in the issue or commit). Issues are the source of truth for planned work; this file is the index, plus anything too small or too open for an issue yet.

## Tracked as issues

| Issue | What | Waiting on |
|---|---|---|
| #17 | Commercialista review of VAT settings and invoicing assumptions | The business (`needs-human`) |
| #28 | Bulk import from the old accounting software | The business (`needs-human`) |
| #34 | How updates are applied | The business (`needs-human`) |
| #35 | Cloudflare Tunnel and Access setup | The business (`needs-human`) |
| #56 | Proposal: public administration invoicing (split payment, FPA12, CIG/CUP) | Review of proposal |
| #57 | Proposal: withholding tax on condominium Invoices | Review of proposal, #17 |
| #58 | Proposal: assisted *beni significativi* VAT split | Review of proposal; its rule is confirmed in #17 |
| #59 | Proposal: payment in instalments | Review of proposal |
| #60 | Proposal: virtual stamp duty | Review of proposal |
| #61 | Proposal: tax bonus wording on Invoices | Review of proposal |
| #64 | Per-row validation errors on Tariffe and Codici IVA pages | — |
| #65 | Review leftovers: Natura DB check, VAT Code picker test, field-work concurrency / Superuser / "installed" tests, technician dropdown reset | — |
| #67 | VAT Codes and VAT summary on Quotes (needed by #22) | — |
| #68 | Edit, delete and touch-move Visits; deactivated Technicians' Visits stay visible | — |
| #69 | Archive Customers and Sites; mark Installed Equipment removed or replaced | — |
| #70 | Visits link and service Installed Equipment (`lastServicedOn`, next due date in SQL) | — |
| #71 | Refuse field work on cancelled Jobs' Visits | — |
| #72 | Stable issue date and validity on Quote PDFs | — |
| #73 | Review leftovers: UI polish and test gaps (#43–#66 reviews) | — |

## Added to existing issues

Review findings folded into planned work, so they are picked up with it:

- **#17:** Registro Imprese / REA; Credit Note numbering (shared sequence or *sezionale*).
- **#19:** concurrency tests on separate connections; Item lock order and `StockLedger.receive()` note; payment method and IBAN on the PDF.
- **#20:** payment method (`ModalitaPagamento`) on Payment Terms; REA fields in Company settings.
- **#22:** Quote VAT Codes (#67); Job guards once invoiced; Visit lines linked to the Invoice that billed them; rounding vs. the Job page total; price policy (comment).
- **#25:** Invoiced and Closed filterable in SQL; Closed Jobs out of the default list.

## Not yet issues

- **Billing price policy:** noted on #22 (recorded prices vs. today's prices for Time & Materials Invoices).
- **Closing a Visit by mistake (#16):** "Done" and "needs another visit" are final; neither the Technician nor Office can reopen a Visit. Accepted trade-off for now; revisit if it happens in practice (an Office "reopen" that reverses the stock usage).
- **Browser test log noise:** the browser suite logs "Transaction query already complete" six times while still passing. Pre-existing since before #16; not investigated.
