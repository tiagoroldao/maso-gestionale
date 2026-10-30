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
