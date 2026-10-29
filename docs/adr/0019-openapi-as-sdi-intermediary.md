# Openapi as SDI intermediary

Automatic SDI Submission and the receiving of Supplier Invoices go through Openapi's SDI API, decided by the business on 2026-10-29 (#92). This replaces ADR 0004's choice of Invoicetronic and keeps its principles:

- **Polling is the source of truth.** An on-premises server may be offline (ADR 0002), so the app asks for outcomes and received files on a schedule (the `sdi` Compose service, `node ace sdi:poll`, every "polling minutes" from Instance settings) and catches up after an outage.
- **Webhooks only trigger an earlier poll.** The webhook is optional, needs a secret and the public URL, and its body is never read.
- **One interface.** Every provider call (send, poll outcomes, receive) sits behind `SdiGateway`, so the provider can be swapped.
- **The app works fully without a connection.** With no token (or manual mode) the manual gateway applies: Office uploads files on the SDI portal and records outcomes by hand, and Supplier Invoices are uploaded as files (#198). Configuring Openapi is an Instance setting, never a requirement.

Sending happens outside the Invoice lock. Confirming marks the Submission "sending" under the lock, sends, then records the result under the lock again. If Openapi refuses the file (a 4xx), nothing was sent and it can be sent again. If the result is unknown (a 5xx, a dropped connection, the process stopping), the Submission stays "sending" and is never sent twice. After a grace period the poller looks the Invoice up at Openapi by number and date. It records it as sent if found, and otherwise makes it ready to send again.

## Confirmed API facts

From Openapi's official documentation and OpenAPI spec (console.openapi.com/apis/sdi, `oas/en/sdi.openapi.json`, read on 2026-10-29):

- **Hosts:** production `https://sdi.openapi.it`, sandbox `https://test.sdi.openapi.it`.
- **Authentication:** `Authorization: Bearer <token>`. Tokens are created in Openapi's console (OAuth section) or through its API, with an expiry date and scopes. A refused token answers 401 `{"success":false,"message":"Wrong Token",…}` (seen on the sandbox).
- **Errors:** `{ success, message, error, data }`, with 400 (validation), 402 (wallet out of credit), 404 and 422 (malformed XML).
- **Sending our own XML:** `POST /invoices` with `Content-Type: application/xml` and the FatturaPA file as the body. The answer is `data.uuid`, and Openapi queues the file for SDI. Variants add a digital signature (`/invoices_signature`), legal storage (`/invoices_legal_storage`) or both. Openapi acts as the transmitter (its own `IdTrasmittente`), so SDI's file name is Openapi's, not ours.
- **Outcomes, by polling:** `GET /invoices_notifications/{uuid}` lists the notices: NS (rejection, with `lista_errori`), RC (delivered), MC (not delivered), NE/DT (public administration acceptance or lapse), AT (PA not deliverable). Each has `created_at` and `message.identificativo_sdi`. `GET /invoices/{uuid}` also gives the invoice's `marking`. We map NS to rejected, RC to delivered, and MC and AT to not deliverable, dated by the notice's day in Rome. NE and DT wait for public administration invoicing (#56).
- **Finding sent files:** `GET /invoices?type=0` filters by `invoiceNumber`, `invoiceDate[after|before]`, `createdAt[…]`, `marking` and `downloaded`, paged with `page`.
- **Received Supplier Invoices, by polling:** `GET /invoices?type=1` (same filters) lists them, and `GET /invoices_download/{uuid}` with `Accept: application/octet-stream` returns the file as SDI delivered it (XML or .p7m). Receiving needs Openapi's recipient code `JKKZDGR` registered with the Agenzia delle Entrate, and a Business Registry Configuration for our fiscal id. The docs also say receiving needs an API configuration with a `supplier-invoice` callback, after which the invoices "can then be accessed via GET /invoices". So the callback must be configured even when we poll (see follow-ups).
- **Sandbox simulation:** `POST /simulate/{type}`, sandbox only. With `supplier-invoice` it takes an invoice as JSON (the buyer's `id_codice` is our fiscal id) and delivers it as received. With `customer-notification` it takes `{ uuid, notification: NS|RC|MC|NE|DT|AT }`. With `legal-storage-receipt` it takes `{ uuid }`. The console's pricing page lists it as `POST /simulate-supplier-invoice`.
- **Callbacks:** `POST /api_configurations` with `{ fiscal_id, callbacks: [{ event, url, auth_header, field }] }`, one configuration per fiscal id, each call replacing the last. Events: `supplier-invoice`, `customer-invoice`, `customer-notification`, `legal-storage-missing-vat`, `legal-storage-receipt`. Calls carry `auth_header` (e.g. `Bearer …`) and are not signed. Our webhook accepts the secret in `Authorization`, as is or after `Bearer `.
- **Legal archiving (_conservazione a norma_):** offered by Openapi as a separate, paid option: `apply_legal_storage` on the Business Registry Configuration, or the `…_legal_storage` endpoints, through a third-party storage platform. It is not part of plain sending.
- **Pricing (console, 2026-10-29):** `POST /invoices` €0.070 (from €0.022 with a subscription), €0.105 with legal storage; `GET /invoices_download` €0.001. `GET /invoices` and `GET /invoices_notifications` have 1000 free calls a day each, so the poller only asks about Submissions still waiting.

## Considered Options

- **Invoicetronic** (ADR 0004): replaced by the business's choice of Openapi, for now.
- **Openapi's callbacks as the source of truth:** rejected for the reasons in ADR 0004: an offline server would miss them, and polling endpoints exist for both outcomes and received files.

## Consequences

- The app doesn't turn on legal archiving: it sends with plain `POST /invoices` and keeps each file as sent. Archiving stays outside the app (ADR 0002), either through Openapi's paid option or the Agenzia delle Entrate's free service.
- The Openapi account is set up once, outside the app: the Business Registry Configuration, the recipient code `JKKZDGR` at the Agenzia delle Entrate, and the API configuration (with the webhook URL shown in Instance settings, if enabled).
- Received files are kept in `sdi_received_files` until the Supplier Invoice intake (#198) takes them.
