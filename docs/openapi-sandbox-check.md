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
- **`--cleanup`** only removes the callback configuration for the fiscal id, and runs no checks.
- Without either, the command changes no set-up: it reads, sends two test invoices, and simulates a received invoice and notices, as the checks below say.
- `--wait` is how long, in seconds, to wait for Openapi to list or store something (120 by default). `--p7m <file>` also tries importing a signed file in check 8 (e.g. `tests/fixtures/supplier_invoice.xml.p7m`, whose buyer is not the sandbox's fiscal id).

The report is Markdown on stdout, ready to paste as a comment on #204; progress goes to stderr. Each check reads PASS, FAIL or SKIP, with notes and, folded, each call's status and the shape of its answer (values hidden but for a few fields like `message` and `marking`). The exit code is 0 when no check fails.

## The checks

1. **The token works:** `GET /business_registry_configurations`, and whether one exists for the fiscal id.
2. **`GET /api_configurations` shape:** `callback` or `callbacks`, an array or an object, per item.
3. **Send and find:** a test FatturaPA (from the app's builder) through `POST /invoices`, then found by its date and number as `findSent` does.
4. **Send with legal storage:** the same through `POST /invoices_legal_storage`; its `legally_stored` and `preserved_document`, its notices, and a simulated `legal-storage-receipt`.
5. **Receive:** `POST /simulate/supplier-invoice`, then `GET /invoices?type=1` until it is listed, and its download. With the placeholder callback this answers option (a): listable although the callback can't be delivered.
6. **Filters:** `invoiceDate[after|before]` and `createdAt[after]` on `GET /invoices` (sent and received), and the list's order.
7. **Notices:** a simulated RC on the invoice from check 3; is it stored at `GET /invoices_notifications/{uuid}`? ADR 0019 records that the sandbox doesn't store simulated notices, so this check is expected to fail there.
8. **Import a received file:** `POST /supplier_invoice_imports_legal_storage` with the file from check 5 (and the `--p7m` file, if given).

Checks that need an earlier one's result (6, 7, 8) are skipped when it has none. The test invoices stay in the sandbox account.

## Tests

`tests/functional/sdi_sandbox_check.spec.ts` runs the command against `FakeOpenapi`, never the network; CI never calls the sandbox.
