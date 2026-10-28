# Maso Gestionale

Management app for a small plumbing business: Customers, Sites and Installed Equipment, Jobs and Visits, Items and stock, invoicing with SDI, and Document Templates.

- Vocabulary: [GLOSSARY.md](GLOSSARY.md)
- Decisions: [docs/adr/](docs/adr/)
- Product requirements: [docs/prd/](docs/prd/)

## Stack

AdonisJS 7 + Inertia + Vue, Postgres, Gotenberg for PDFs, all run with Docker Compose on one machine (ADRs 0002, 0003, 0005).

## Development

Requires Node 24 and Docker.

```sh
cp .env.example .env
node ace generate:key          # fills APP_KEY
npm ci
docker compose up -d db gotenberg
node ace migration:run
npm run dev                     # http://localhost:3333
```

On a fresh database every page redirects to `/setup`, which creates the Superuser and the first Admin.

To try the app with realistic data instead, run `npm run dev:reset`. It **wipes the dev database**, migrates it and seeds a small business: Customers of every type, a stocked catalogue, Jobs in every status, Visits around today and a draft Invoice. Every account's password is `password123`:

| Role       | Email                                 |
| ---------- | ------------------------------------- |
| Superuser  | `superuser@maso.test`                 |
| Admin      | `titolare@maso.test`                  |
| Office     | `ufficio@maso.test`                   |
| Technician | `luca@maso.test`, `giorgio@maso.test` |

The dev database is published on host port 5433, Gotenberg on 3010, both on localhost only. Override with `DB_HOST_PORT` / `GOTENBERG_PORT`. When pulling changes, compare your `.env` with `.env.example`: new required variables (such as `GOTENBERG_URL`) stop the app from booting until they are set.

### Route registry

The typed client route registry in `.adonisjs/` and the model schema in `database/schema.ts` are generated. After changing routes, controllers or migrations, run `npm run codegen` (with migrations applied) and commit the result; CI fails when they are stale.

## Translations

The interface is Italian (ADR 0006). Every user-facing string lives in `resources/lang/it/*.json` as an ICU message:

- `ui.json`: the Vue pages, via `t('ui.…')` from `~/i18n`
- `validator.json`: validation messages and field names
- `flash.json`, `errors.json`, `documents.json`: server messages

Don't put literal text in pages or controllers; add a key instead. Tests read expected text through `tests/helpers/i18n.ts`.

## Tests

```sh
npx playwright install chromium   # once
node ace test                      # all suites
node ace test functional           # one suite
```

Tests run against the `maso_test` database, which the Postgres container creates on first start. Each test runs in a transaction that is rolled back afterwards.

## Running the full stack

```sh
docker compose up -d --build
```

The `app` container runs pending migrations on start-up and then serves on port 3333. Uploaded files (such as the company logo) live in the `app-storage` volume; in development they go to `storage/` in the repo (git-ignored), or wherever `STORAGE_PATH` points.

## Releases

Pushing a version tag publishes the app image to GitHub Container Registry and creates a GitHub release listing the changes since the previous tag:

```sh
git tag v1.0.0 && git push origin v1.0.0
```

The image is `ghcr.io/tiagoroldao/maso-gestionale`, tagged with the version (`1.0.0`), the minor line (`1.0`) and `latest`. On the server, pin the version in `.env` and pull it instead of building:

```sh
APP_VERSION=1.0.0 docker compose pull app && docker compose up -d
```
