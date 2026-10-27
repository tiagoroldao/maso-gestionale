# Italian interface from one ICU catalogue shared by server and client

The people using the app are Italian office staff and technicians, so the interface is in Italian. Dates are shown as dd/mm/yyyy, money as 1.234,56 €, and the business timezone is Europe/Rome. Code, the glossary's canonical terms and the database stay in English (the glossary notes the Italian label for each term). Every user-facing string lives in `resources/lang/it/*.json` as ICU messages, read by `@adonisjs/i18n` on the server (validation, flash and error messages) and by a small `t()` helper in the Vue pages. So there is one catalogue in one syntax, and another language means adding a folder rather than rewriting screens.

## Considered Options

- **Hard-coded Italian strings**: simpler today, but any second language or wording change means touching every page.
- **vue-i18n for the client plus AdonisJS i18n for the server**: two catalogues in two message syntaxes that would drift apart.

## Consequences

- Tests assert user-visible text through the catalogue (`tests/helpers/i18n.ts`), not literal Italian.
- Some names are deliberate: the Admin role is shown as *Titolare*, because *Amministratore* would clash with a condominium's *amministratore*, who is a Customer.
