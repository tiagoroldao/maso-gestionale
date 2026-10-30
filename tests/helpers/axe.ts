import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from 'playwright'

const BLOCKING = new Set(['serious', 'critical'])

/**
 * The accessibility violations of serious or critical impact (labels,
 * contrast, focus…) on the parts of `page` that are on the new UI (#252).
 * Inside the app shell, the content area (`.app-main`) is left out unless
 * `content` is set: pass it for a screen that has moved to the new UI.
 * Pages outside the shell (sign-in, setup, errors) have no `.app-main`, so
 * they are checked whole. Returns one line per violation, so a failing
 * assertion says what to fix.
 */
export async function seriousA11yViolations(page: Page, options: { content?: boolean } = {}) {
  // Colours caught mid-transition (after a theme or viewport change) fail
  // the contrast check: wait for finite transitions and animations to end
  await page.waitForFunction(
    `document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)`
  )
  const axe = new AxeBuilder({ page })
  const { violations } = await (options.content ? axe : axe.exclude('.app-main')).analyze()
  return violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ''))
    .map(
      (violation) =>
        `${violation.impact} ${violation.id}: ${violation.help} (${violation.nodes
          .map((node) => node.target.join(' '))
          .join(', ')})`
    )
}
