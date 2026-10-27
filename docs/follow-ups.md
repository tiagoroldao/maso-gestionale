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

## Not yet issues

- **Billing price policy:** noted on #22 (recorded prices vs. today's prices for Time & Materials Invoices).

- **Closing a Visit by mistake (#16):** "Done" and "needs another visit" are final; neither the Technician nor Office can reopen a Visit. Accepted trade-off for now; revisit if it happens in practice (an Office "reopen" that reverses the stock usage).
- **Browser test log noise:** the browser suite logs "Transaction query already complete" six times while still passing. Pre-existing since before #16; not investigated.
