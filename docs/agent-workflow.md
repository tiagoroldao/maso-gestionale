# Agent workflow

The loop for an AFK issue (`ready-for-agent`), from branch to merge. HITL issues (`needs-human`) stop the loop: report to the user instead.

## Steps

1. **Branch** from a fresh `origin/main`: `git fetch && git checkout -b <feat|fix|chore>/<issue>-<slug> origin/main`.
2. **Build** the slice end to end (migration, model, validator, controller, page, catalogue strings, tests). Vocabulary from `GLOSSARY.md`; every visible word in `resources/lang/it/*.json`. Pages follow "UI scope" in `CODING_STANDARDS.md` (ADR 0009, ADR 0020).
3. **Regenerate** after route, controller or migration changes: `npm run codegen` (needs migrations applied to the dev or scratch database). Commit `.adonisjs/` and `database/schema.ts` with the change; CI fails on stale generated files.
4. **Check** locally: `npm run lint`, `npm run typecheck`, then `node ace test --files <touched specs>` while iterating and the full `node ace test` once before pushing.
   - **UI work** (a page, a layout, a component) is also checked by eye before the PR: `npm run ui:shots -- <path> [--role=office|admin|technician|superuser]` saves PNGs of each path at the phone, tablet and desktop widths (`docs/ui.md` "Screen sizes"), light and dark, and prints their paths. Read them, at least phone and desktop, against `docs/ui.md` and `docs/ui/mockups/`, fix what differs, and say in the PR what you looked at. A new or changed component goes in the gallery (`/dev/ui`), so `npm run ui:shots -- /dev/ui` shows it in its states. Lint enforces Tailwind class order (`npm run format` fixes it) and the colour tokens; browser tests of a screen on the new UI run axe (`CODING_STANDARDS.md` "Tests").
5. **Push and open the PR** (`Closes #N`). Wait for the CI run whose `headSha` is the pushed commit; fix until green.
6. **Review** with the `pr-reviewer` agent. Fix what it marks to fix; send fixes back to the _same_ reviewer for a re-review. Merge only on a MERGE verdict for the latest commit.
7. **File deferred findings** before merging, in this PR, as `docs/follow-ups.md` describes.
8. **Merge**: `gh pr merge N --merge --delete-branch`, then `git checkout main && git pull`.

## Gotchas

- **History:** add commits and merge `origin/main` into the branch; history on pushed branches stays as it is (force-push is denied). When squashing locally, squash against `origin/main`, never a stale local `main`.
- **Unmerged migrations** may be edited in place; apply the same change to the dev database by hand (`docker compose exec -T db psql -U maso -d maso`) or roll back and re-run. Merged migrations are append-only: add a new one.
- **Tests** run inside one global transaction on one connection (`tests/bootstrap.ts`). Locks are re-entrant there, so a concurrency test passes even without the lock: test locking on separate connections outside the global transaction.
- **Running tests:** in the foreground, bounded: `perl -e 'alarm 900; exec @ARGV' node ace test …` (macOS has no `timeout`). Never as a background task or piped through `tail`: hung background runs have blocked reviews.
- **Several specs:** one `--files=<path>` per spec. Extra paths after one `--files` are read as suite names: the run errors and hangs.
- **Seeds** live in migrations (`this.defer`), so seeded rows (Payment Terms, VAT Codes) exist in every test.
- **Playwright** `window.confirm()` dialogs need `page.on('dialog', (d) => d.accept())`.
- **Money** is decimal strings through `shared/money.ts` (ADR 0007); dates and times are Europe/Rome (`shared/dates.ts`).
- **Imports from `shared/`**: `#shared/*` on the server, `@shared/*` in pages.
- **Controllers: the controller class comes first in its file.** Codegen reads the first class, so a helper class (e.g. an error) above it silently drops the 422 validation-error types for every action, and the pages' `<Form>` errors become `{}` (typecheck fails). Put helper classes after the controller, or in a service.
- **Worktrees never use the dev database.** A worktree's `.env` copied from the main checkout points at `maso`: set its `DB_DATABASE` to a scratch database (or prefix each command, as below) before running any `ace` command there, and chain setup commands with `&&`, never `;`, so a failed step can't leave the next one on `maso`. A rollback on `maso` runs real `down()` migrations (some delete data).
- **Scratch databases:** `docker compose exec -T db psql -U maso -d postgres -c "CREATE DATABASE maso_bNN"`, then `DB_DATABASE=maso_bNN node ace migration:run` and `DB_DATABASE=maso_bNN npm run codegen` (plain `npm run codegen` reads the dev database). Drop it when the branch merges (`DROP DATABASE maso_bNN`).
- **`ui:shots` in a worktree:** it uses the server on `.env`'s `PORT`, or starts `node ace serve` for the run and stops it after. Give the worktree its own `PORT` (another checkout may be serving 3333) and a scratch database, migrated and seeded with `DB_DATABASE=maso_bNN node ace db:seed` (the accounts are in the README). The PNGs go to `tmp/ui-shots/` (git-ignored), beside the server's log. In a full-page shot the sticky sidebar ends at the viewport's height: not a bug.
- **Blocked commands:** when the permission system blocks a command, stop and report it; never split, rephrase, or hand it to another agent. (The worktree guard asking to split combined commands is different: follow it.)
