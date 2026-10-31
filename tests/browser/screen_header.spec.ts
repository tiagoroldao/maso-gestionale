import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * The screen header's actions (inertia/components/screen/screen_actions.vue),
 * on the component gallery's samples (/dev/ui).
 */
test.group('Screen header in the browser', () => {
  test("a primary's long disabled reason wraps under the buttons, which stay together (#282)", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const page = await visit('/dev/ui')

    for (const size of ['desktop', 'tablet'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      const header = page.getByTestId('blocked-primary')
      const reason = header.getByText(it('ui.devUi.action.longReason'))
      await reason.waitFor()
      const secondary = await header
        .getByRole('button', { name: it('ui.devUi.action.secondary') })
        .boundingBox()
      const primary = await header
        .getByRole('button', { name: it('ui.devUi.action.primary') })
        .boundingBox()
      const more = await header
        .getByRole('button', { name: it('ui.screen.moreActions') })
        .boundingBox()

      // Secondary, primary, "⋯" side by side on one row, as far apart as each other
      const before = primary!.x - (secondary!.x + secondary!.width)
      const after = more!.x - (primary!.x + primary!.width)
      assert.isAbove(before, 0, size)
      assert.equal(Math.round(before), Math.round(after), size)
      assert.equal(Math.round(primary!.y), Math.round(secondary!.y), size)
      assert.equal(Math.round(more!.y), Math.round(primary!.y), size)
      // The reason under them
      const under = await reason.boundingBox()
      assert.isAtLeast(under!.y, primary!.y + primary!.height, size)
    }
  })
})
