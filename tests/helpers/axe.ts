import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from 'playwright'

const BLOCKING = new Set(['serious', 'critical'])

/**
 * The accessibility violations of serious or critical impact (labels,
 * contrast, focus…) on the parts of `page` that are on the new UI (#252).
 * Today that is the app shell: the content area (`.app-main`) holds pages
 * not yet moved, so it is left out until they are. Returns one line per
 * violation, so a failing assertion says what to fix.
 */
export async function seriousA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).exclude('.app-main').analyze()
  return violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ''))
    .map(
      (violation) =>
        `${violation.impact} ${violation.id}: ${violation.help} (${violation.nodes
          .map((node) => node.target.join(' '))
          .join(', ')})`
    )
}
