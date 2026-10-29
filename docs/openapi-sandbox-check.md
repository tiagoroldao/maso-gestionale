# Openapi sandbox check

`node ace sdi:sandbox-check` (#219, #223) checks Openapi's sandbox against what the app assumes about Openapi's SDI API (ADR 0019): the facts still to confirm, collected on #204. Run it while setting up, and again before going live. It goes through the app's own `OpenapiSdiGateway` wherever the gateway has the call, so it also exercises the app's code.

## Running it

From a checkout with dependencies installed, with the sandbox token (from Openapi's console, sandbox scopes) in `.env` as `OPENAPI_SANDBOX_TOKEN=…` (`.env` is never committed; an exported variable works too):

```sh
npm run -s sdi:sandbox-check:setup > sandbox-report.md   # set the account up, then check
npm run -s sdi:sandbox-check > sandbox-report.md         # check again, set-up unchanged
npm run -s sdi:sandbox-check:cleanup                     # remove the callback configuration
```

`-s` keeps npm's own header out of the report. The scripts run `node ace sdi:sandbox-check` with `--setup`, nothing or `--cleanup`; other options go after `--` (e.g. `npm run -s sdi:sandbox-check -- --p7m file.p7m`). `sandbox-report*.md` is git-ignored: a report can hold callback URLs.

- **Sandbox only.** The host is `https://test.sdi.openapi.it`, hard-coded; anything else is refused. The token and the `Authorization` header are never printed.
- **`--setup`** creates the Business Registry Configuration for `--fiscal-id` (default `02903752463`, the one already in the sandbox) if missing, and registers the `supplier-invoice` callback, to `https://invalid.invalid/sdi/webhook` unless `--callback-url` says otherwise. Each callback write replaces the whole configuration; other events' callbacks are kept.
- **`--callback-url`**: the placeholder can't be delivered, so check 5 answers option (a), "listable although the callback can't be delivered". Any other URL (a request-bin, or one answering HTTP 500) may be reached, and the report says the run tests delivery to it, not option (a).
- **`--legal-storage-fiscal-id <id>`**, with `--setup` only: a second, invented fiscal id (11 digits, checksum-valid, e.g. `12345678903`), registered with `apply_legal_storage: true` and the same `supplier-invoice` callback, for checks 9 to 11. Openapi sets `apply_legal_storage` only when a registration is created, so an existing registration without it fails the set-up: delete it in Openapi's console, or use another fiscal id.
- **`--cleanup`** only removes the callback configuration for `--fiscal-id` (pass `--fiscal-id <id>` for the legal-storage one), and runs no checks. Deleting a Business Registry Configuration is left to Openapi's console. A configuration as read may not say whose it is, so it first probes the `fiscal_id` filter with `00000000000`, a fiscal id no one holds: the filter is honoured when that lists nothing, or answers 404 with error 420 ("Fiscal ID not found or not registered", as the sandbox does); otherwise it removes nothing and fails, since what it listed could be other fiscal ids' configurations. It also removes nothing listed as another fiscal id's. Several items for the fiscal id are expected (one per event callback) and are all removed.
- Without `--setup` or `--cleanup`, the command changes no set-up: it reads, sends two test invoices, and simulates a received invoice and notices, as the checks below say.
- `--wait` is how long, in seconds, to wait for Openapi to list or store something: 120 by default, but 600 for receiving (checks 5 and 11) when the callback can't be delivered, since Openapi then lists the invoice only after minutes (ADR 0019). `--wait` sets every wait. `--p7m <file>` also tries importing a signed file in check 8 (e.g. `tests/fixtures/supplier_invoice.xml.p7m`, whose buyer is not the sandbox's fiscal id).

The report is Markdown on stdout, ready to paste as a comment on #204; progress goes to stderr. Each check reads PASS, FAIL, SKIP or INCONCLUSIVE (not seen within the wait: neither passed nor failed), with notes and, folded, each call's status and the shape of its answer (values hidden but for a few fields like `message`, `marking` and `apply_legal_storage`; ids and SDI ids hidden too). The exit code is 0 when no check fails; SKIP and INCONCLUSIVE don't count as failures. Requests never follow redirects.

## The checks

1. **The token works:** `GET /business_registry_configurations`, whether one exists for the fiscal id, and its `apply_legal_storage`.
2. **`GET /api_configurations` shape:** `callback` or `callbacks`, an array or an object, per item, and whether the `fiscal_id` filter is honoured, probed with `00000000000` (it fails if the filter is ignored or the probe proves nothing). A fiscal id not registered is skipped.
3. **Send and find:** a test FatturaPA (from the app's builder) through `POST /invoices`, then found by its date and number as `findSent` does (#204's headline question). It notes how many attempts and seconds that took, and the file's `marking` when first found, so a file found while still queued shows as such.
4. **Send with legal storage:** the same through `POST /invoices_legal_storage`; its `legally_stored` and `preserved_document`, its notices, and a simulated `legal-storage-receipt`. Without `apply_legal_storage` on the registration Openapi refuses it (412, error 387): the check is then skipped, pointing at checks 9 to 11.
5. **Receive:** `POST /simulate/supplier-invoice`, then `GET /invoices?type=1` until it is listed, how long that took, and its download. It notes the simulated body's keys and whom it was for (`codice_destinatario`, buyer, supplier), and, listed or not, what `GET /invoices?type=1` lists without `createdAt`: the total and the newest three (when created, `marking`, `downloaded`, whether `downloaded_at` is set, and whether the recipient is the fiscal id). The report says whether the run answers option (a) or tests delivery.
6. **Filters:** `invoiceDate[after|before]` and `createdAt[after]` on `GET /invoices` (sent and received), and the list's order. Lists are paged as the gateway pages them (up to 50 pages); a list cut off there is noted.
7. **Notices:** a simulated RC on the invoice from check 3, stored at `GET /invoices_notifications/{uuid}` and read by the gateway as delivered. The sandbox stores simulated notices (ADR 0019), so one not stored within the wait fails.
8. **Import a received file:** the file from check 5 through the gateway's `archiveReceived`, as the app archives a Supplier Invoice (#214): a .p7m as its extracted XML. It notes how many uuids the gateway read from the answer, and fails when the import is refused or answers none. A .p7m (the received file, or the `--p7m` file) is also sent as it is to `POST /supplier_invoice_imports_legal_storage`, in a raw call under its own SDI id, to learn whether Openapi takes it whole.

With `--legal-storage-fiscal-id`, for that registration:

9. **A plain send is archived:** a test invoice from it through plain `POST /invoices`, then `legally_stored` and `preserved_document` until it is archived. Not archived within the wait is INCONCLUSIVE: archiving may come later.
10. **`/invoices_legal_storage`:** whether Openapi takes the per-file endpoint for a registration with the flag; it fails when refused.
11. **A received invoice is archived:** a simulated Supplier Invoice to it, listed by `GET /invoices?type=1`, then whether it is marked `legally_stored` (INCONCLUSIVE when not within the wait).

Checks that need an earlier one's result (6, 7, 8, and 9 to 11 on the set-up) are skipped when it has none. The test invoices stay in the sandbox account.

## Tests

`tests/functional/sdi_sandbox_check.spec.ts` runs the command against `FakeOpenapi`, never the network, setting the token itself whatever `.env` holds; CI never calls the sandbox. `tests/functional/openapi_sandbox.spec.ts` reads the real sandbox only when asked with `OPENAPI_SANDBOX_LIVE=1` (and the token set); a token in `.env` alone doesn't run it.
