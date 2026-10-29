# Openapi sandbox check

`node ace sdi:sandbox-check` (#219) checks Openapi's sandbox against what the app assumes about Openapi's SDI API (ADR 0019): the facts still to confirm, collected on #204. Run it while setting up, and again before going live. It goes through the app's own `OpenapiSdiGateway` wherever the gateway has the call, so it also exercises the app's code.

## Running it

From a checkout with dependencies installed, and the sandbox token in the environment (never in a committed file):

```sh
export OPENAPI_SANDBOX_TOKEN=…            # from Openapi's console, sandbox scopes
node ace sdi:sandbox-check --setup > sandbox-report.md   # set the account up, then check
node ace sdi:sandbox-check > sandbox-report.md           # check again, set-up unchanged
node ace sdi:sandbox-check --cleanup                     # remove the callback configuration
```

- **Sandbox only.** The host is `https://test.sdi.openapi.it`, hard-coded; anything else is refused. The token and the `Authorization` header are never printed.
- **`--setup`** creates the Business Registry Configuration for `--fiscal-id` (default `02903752463`, the one already in the sandbox) if missing, and registers the `supplier-invoice` callback, to `https://invalid.invalid/sdi/webhook` unless `--callback-url` says otherwise. Each callback write replaces the whole configuration; other events' callbacks are kept.
- **`--cleanup`** only removes the callback configuration for the fiscal id, and runs no checks. A configuration as read doesn't say whose it is, so it first probes the `fiscal_id` filter with `00000000000`, a fiscal id no one holds: unless that lists nothing, it removes nothing and fails, since what it listed could be other fiscal ids' configurations. It also removes nothing listed as another fiscal id's. Several items for the fiscal id are expected (one per event callback) and are all removed.
- Without either, the command changes no set-up: it reads, sends two test invoices, and simulates a received invoice and notices, as the checks below say.
- `--wait` is how long, in seconds, to wait for Openapi to list or store something (120 by default). `--p7m <file>` also tries importing a signed file in check 8 (e.g. `tests/fixtures/supplier_invoice.xml.p7m`, whose buyer is not the sandbox's fiscal id).

The report is Markdown on stdout, ready to paste as a comment on #204; progress goes to stderr. Each check reads PASS, FAIL, SKIP or INCONCLUSIVE (a known sandbox limitation: neither passed nor failed), with notes and, folded, each call's status and the shape of its answer (values hidden but for a few fields like `message` and `marking`; ids and SDI ids hidden too). The exit code is 0 when no check fails; SKIP and INCONCLUSIVE don't count as failures. Requests never follow redirects.

## The checks

1. **The token works:** `GET /business_registry_configurations`, and whether one exists for the fiscal id.
2. **`GET /api_configurations` shape:** `callback` or `callbacks`, an array or an object, per item, and whether the `fiscal_id` filter is honoured, probed with `00000000000`, a fiscal id no one holds, which must list nothing (it fails if the filter is ignored).
3. **Send and find:** a test FatturaPA (from the app's builder) through `POST /invoices`, then found by its date and number as `findSent` does (#204's headline question). It notes how many attempts and seconds that took, and the file's `marking` when first found, so a file found while still queued shows as such.
4. **Send with legal storage:** the same through `POST /invoices_legal_storage`; its `legally_stored` and `preserved_document`, its notices, and a simulated `legal-storage-receipt`.
5. **Receive:** `POST /simulate/supplier-invoice`, then `GET /invoices?type=1` until it is listed, and its download. With an undeliverable callback URL (the placeholder) this answers option (a): listable although the callback can't be delivered. The report says so, and flags a run whose callback may be deliverable, since that run doesn't answer it.
6. **Filters:** `invoiceDate[after|before]` and `createdAt[after]` on `GET /invoices` (sent and received), and the list's order. Lists are paged as the gateway pages them (up to 50 pages); a list cut off there is noted.
7. **Notices:** a simulated RC on the invoice from check 3; is it stored at `GET /invoices_notifications/{uuid}`? ADR 0019 records that the sandbox doesn't store simulated notices, so when none is stored within `--wait` the check is INCONCLUSIVE, not FAIL. It fails when the simulation is refused, on an error, or when the notice is read as anything but delivered.
8. **Import a received file:** `POST /supplier_invoice_imports_legal_storage` with the file from check 5 (and the `--p7m` file, if given, sent as it is, on purpose). Called directly for now; the XML import is to move to the gateway's `archiveReceived` (#222), while the .p7m stays a raw call, since the gateway sends a .p7m as its extracted XML (`docs/follow-ups.md`).

Checks that need an earlier one's result (6, 7, 8) are skipped when it has none. The test invoices stay in the sandbox account.

## Tests

`tests/functional/sdi_sandbox_check.spec.ts` runs the command against `FakeOpenapi`, never the network; CI never calls the sandbox.
