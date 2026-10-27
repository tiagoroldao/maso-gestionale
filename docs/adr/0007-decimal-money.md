# Money as decimals: numeric in Postgres, strings on the wire, big.js in code

Prices, VAT and invoice totals must add up exactly the way the accountant's and the SDI's checks do, so money is never a JavaScript float. Amounts are stored as Postgres `numeric`, with 4 decimals for unit prices and 2 for totals. They travel between server and pages as strings ("12.5000") and are calculated with `big.js` through `shared/money.ts`, which the server and the Vue pages both import. People type amounts with an Italian decimal comma ("12,50"). Thousands separators are rejected rather than guessed. The only currency is EUR.

## Considered Options

- **Integer cents:** exact and fast, but unit prices need more than 2 decimals (small parts sold by the piece), and line totals would need scaled integers everywhere.
- **JS numbers with rounding at the end:** rejected. Float errors show up in VAT summaries and would make the FatturaPA totals fail validation.

## Consequences

- Lucid returns `numeric` columns as strings. Models keep them as strings, and arithmetic goes through `shared/money.ts`.
- Rounding rules (half-up to cents per line, VAT per rate) will live in `shared/money.ts`, so the invoice preview in the browser and the saved invoice agree.
