import type { Page } from 'playwright'
import { it } from '#tests/helpers/i18n'

/**
 * Chooses one of a screen's overflow actions (docs/ui.md "Actions"):
 * opens "⋯" in its header, then picks the item by its label.
 */
export async function chooseMoreAction(page: Page, label: string) {
  await page.getByRole('button', { name: it('ui.screen.moreActions') }).click()
  await page.getByRole('menuitem', { name: label }).click()
}

/**
 * Holds the next request the screen sends to `path` (a save) until
 * `answer()`, so a test can check the screen while the save is in flight.
 * `sent` resolves once it is sent; `answered`, once the page it is answered
 * with (`answeredBy`, by default `path` itself) is back.
 */
export async function holdSave(
  page: Page,
  { method, path, answeredBy = path }: { method: string; path: string; answeredBy?: string }
) {
  let answer!: () => void
  const held = new Promise<void>((resolve) => (answer = resolve))
  await page.route(
    `**${path}`,
    async (route) => {
      await held
      await route.continue()
    },
    { times: 1 }
  )
  const sent = page.waitForRequest(
    (request) => request.method() === method && new URL(request.url()).pathname === path
  )
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === answeredBy
  )
  return { sent, answered, answer }
}
