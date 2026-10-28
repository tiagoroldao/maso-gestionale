# Follow-ups

Work deliberately left for later: review findings not fixed in their PR, decisions deferred to a later issue, and known noise. Every postponed finding or decision gets an entry (and an issue, if it is work) in the PR that postpones it; remove it when it's done or dropped (with the reason in the issue or commit). Issues are the source of truth for planned work; this file is the index, plus anything too small or too open for an issue yet.

## Tracked as issues

| Issue | What                                                                                      | Waiting on                                        |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| #17   | Commercialista review of VAT settings and invoicing assumptions                           | The business (`needs-human`)                      |
| #28   | Bulk import from the old accounting software                                              | The business (`needs-human`)                      |
| #34   | How updates are applied                                                                   | The business (`needs-human`)                      |
| #35   | Cloudflare Tunnel and Access setup                                                        | The business (`needs-human`)                      |
| #56   | Proposal: public administration invoicing (split payment, FPA12, CIG/CUP)                 | Review of proposal                                |
| #57   | Proposal: withholding tax on condominium Invoices                                         | Review of proposal, #17                           |
| #58   | Proposal: assisted _beni significativi_ VAT split                                         | Review of proposal; its rule is confirmed in #17  |
| #59   | Proposal: payment in instalments                                                          | Review of proposal                                |
| #60   | Proposal: virtual stamp duty                                                              | Review of proposal                                |
| #61   | Proposal: tax bonus wording on Invoices                                                   | Review of proposal                                |
| #64   | Per-row validation errors on Tariffe and Codici IVA (`ui-later`)                          | The UX pass                                       |
| #65   | Review follow-ups: Natura DB check, field-work tests, functional leftovers moved from #73 | —                                                 |
| #73   | UX backlog: polish found in reviews (`ui-later`)                                          | The UX pass                                       |
| #92   | Automatic SDI Submission through Invoicetronic (send outside the Invoice lock)            | The business (`needs-human`): account and API key |
| #102  | Refuse correcting a rejected Invoice below what is already paid                           | —                                                 |
| #103  | Closed Jobs: what stays editable; Payments after archiving                                | —                                                 |

## Added to existing issues

Review findings folded into planned work, so they are picked up with it:

- **#17:** Registro Imprese / REA; Credit Note numbering (shared sequence or _sezionale_).
- **#19:** concurrency tests on separate connections; Item lock order and `StockLedger.receive()` note; payment method and IBAN on the PDF.
- **#20:** payment method (`ModalitaPagamento`) on Payment Terms; REA fields in Company settings; global discount written as one negative line per VAT rate, matching `invoiceTotals()`; summary rows grouped by rate and Natura vs. legal note (comments).
- **#23:** signed VAT summary rows in the discount split, once deductions exist (comment).
- **#22** (Quoted Job → draft): Quote VAT Codes (#67); Job guards once invoiced.
- **#74** (Time & Materials → draft): rounding vs. the Job page total; price policy (comment on #22).
- **#75:** Visit lines linked to the Invoice that billed them.
- **#25:** Invoiced and Closed filterable in SQL; Closed Jobs out of the default list.

## Not yet issues

- **Quote declines cancel the Job inside `Quotes.decide`** (two lines setting status and date), not through `Jobs.cancel`, which opens its own transaction and would deadlock on the Job row `decide` holds. Harmless today (a draft Quote's Job can't have Invoices); when Job cancellation gains more guards or side effects, let `Jobs.cancel` take the caller's transaction and use it from both (from the #86 and #94 reviews).
- **Customer's role at a Site** (owner, administrator, tenant): a domain question raised in the #43 review; decide during the UX pass or when a feature needs it.
- **Archived-reference check outside the lock:** Quote and Invoice saves read which archived Items and VAT Codes the record already uses before locking it, so a concurrent save or archive could let an archived reference onto a draft. Move the check inside the locked transaction for both (from the #77 review); likewise `Invoices.create` checks an archived Customer only in the validator (harmless: Invoices don't block archiving) (from the #95 review).
- **Billing price policy:** comment on #22, applies to #74 (recorded prices vs. today's prices).
- **Closing a Visit by mistake (#16):** "Done" and "needs another visit" are final; neither the Technician nor Office can reopen a Visit. Accepted trade-off for now; revisit if it happens in practice (an Office "reopen" that reverses the stock usage).
- **Invoice PDF logo:** finalised Invoices copy the company's details, but the PDF still uses the current logo from Company settings, so changing the logo changes old PDFs (from the #82 review). Copy the logo file reference at finalising if this matters.
- **pg deprecation warning in tests:** "client.query() when the client is already executing a query" appears in functional tests (field work, dev seeder) under the global transaction: some code path runs queries in parallel on one connection. Find it with `node --trace-deprecation` before the pg 9 upgrade.
- **Dev seed timing:** the seeder starts today's boiler Visit (09–13) whatever the time, so seeding early or late gives an in-progress Visit outside its hours. Harmless. Its test can also fail if midnight passes between seeding and loading My Visits (milliseconds; no action).
- **Release image is amd64 only** (#36): add `docker/setup-qemu-action` and `platforms: linux/amd64,linux/arm64` if the server turns out to be ARM (ADR 0002: whatever hardware the business owns) (from the #100 review).
- **`latest` follows the newest tag pushed** (#36): a hotfix on an older line (`v1.0.1` after `v1.1.0`) moves `latest` back. Only matters once old lines get patches; pin `APP_VERSION` meanwhile (from the #100 review).
- **Concurrent equipment removal untested:** `FieldWork.removeItem` locks the equipment it created before checking whether another line or Visit uses it. Only reading the code checks this; no test runs two connections against it (from the #98 review).
- **Equipment edit lock untested** (#99): only reading the code shows the edit's `FOR UPDATE` against a closing Visit works; no test runs two connections. The race tests also omit the empty form fields the page sends and don't assert the redirect target (from the #104 review).
- **Small leftovers from the #97 review:** the zero-amount Payment test checks the field, not the `amount.positive` message; the `amountRule` docstring line is over 100 characters.
- **Dates rely on the server's time zone:** "today" checks (e.g. a notice date not in the future, not before the upload day) use the process zone, so they hold only with `TZ=Europe/Rome`, which compose, CI and `.env` all set (from the #101 review).
- **Invoice edit page loads every Submission's XML** to work out `hasFile`; select a boolean instead if Invoices accumulate many Submissions (from the #101 review).
- **Invoice list total vs. stored total** (#25): the Invoice list shows the total worked out from the lines next to a payment status based on the stored `total`. They only differ if they drift; issued Invoices could show the stored value (from the #97 review).
- **Job filter values copied in two places** (#25): the page and the validator each list the Job filter values, and `DisplayedJobStatus` lives in `app/services`, not `shared/`. Move them to one shared list (from the #97 review).
- **Payment dated before the Invoice** (#25): `paidOn` can be earlier than the Invoice's `issuedOn` (an advance paid before issuing is plausible, so decide before refusing it) (from the #97 review).
- **Browser test log noise:** the browser suite logs "Transaction query already complete" six times while still passing. Pre-existing since before #16; not investigated.
