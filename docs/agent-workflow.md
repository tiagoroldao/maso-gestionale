# Agent workflow

The loop for an AFK issue (`ready-for-agent`), from branch to merge. HITL issues (`needs-human`) stop the loop: report to the user instead.

## Steps

1. **Branch** from a fresh `origin/main`: `git fetch && git checkout -b <feat|fix|chore>/<issue>-<slug> origin/main`.
2. **Build** the slice end to end (migration, model, validator, controller, page, catalogue strings, tests). Vocabulary from `GLOSSARY.md`; every visible word in `resources/lang/it/*.json`.
3. **Regenerate** after route, controller or migration changes: `npm run codegen` (needs migrations applied to the dev database). Commit `.adonisjs/` and `database/schema.ts` with the change; CI fails on stale generated files.
4. **Check** locally: `npm run lint`, `npm run typecheck`, then `node ace test --files <touched specs>` while iterating and the full `node ace test` once before pushing.
5. **Push and open the PR** (`Closes #N`). Wait for the CI run whose `headSha` is the pushed commit; fix until green.
6. **Review** with the `pr-reviewer` agent. Fix what it marks to fix; send fixes back to the _same_ reviewer for a re-review. Merge only on a MERGE verdict for the latest commit.
7. **File deferred findings** before merging: every item in the reviewer's Deferred section goes into an issue (if it is work) and `docs/follow-ups.md`, in this PR.
8. **Merge**: `gh pr merge N --merge --delete-branch`, then `git checkout main && git pull`.

## Gotchas

- **History:** add commits and merge `origin/main` into the branch; history on pushed branches stays as it is (force-push is denied). When squashing locally, squash against `origin/main`, never a stale local `main`.
- **Unmerged migrations** may be edited in place; apply the same change to the dev database by hand (`docker compose exec -T db psql -U maso -d maso`) or roll back and re-run. Merged migrations are append-only: add a new one.
- **Tests** run inside one global transaction on one connection (`tests/bootstrap.ts`). Locks are re-entrant there, so a concurrency test passes even without the lock: test locking on separate connections outside the global transaction.
- **Seeds** live in migrations (`this.defer`), so seeded rows (Payment Terms, VAT Codes) exist in every test.
- **Playwright** `window.confirm()` dialogs need `page.on('dialog', (d) => d.accept())`.
- **Money** is decimal strings through `shared/money.ts` (ADR 0007); dates and times are Europe/Rome (`shared/dates.ts`).
- **Shared constants** used by both server and pages live in `shared/` (`#shared/*` on the server, `@shared/*` in pages).
