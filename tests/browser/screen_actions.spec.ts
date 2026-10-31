import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { createItem } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * The screen kit's actions (inertia/components/screen/screen_actions.vue)
 * where they depend on the device, shown on the Item's screen.
 */
test.group('Screen actions in the browser', () => {
  test("the phone's bottom bar keeps its button clear of the iPhone's home indicator (#260)", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const item = await createItem()

    const page = await visit(`/items/${item.id}`)
    await page.setViewportSize(SCREEN_SIZES.phone)
    const bar = page.getByTestId('primary-action')
    const button = bar.getByRole('button', { name: it('ui.items.receive') })
    await button.waitFor()
    const bottom = (box: { y: number; height: number } | null) =>
      Math.round((box?.y ?? 0) + (box?.height ?? 0))

    // No safe area: the bar at the bottom of the screen, its button above that
    const height = SCREEN_SIZES.phone.height
    assert.equal(bottom(await bar.boundingBox()), height)
    const plain = bottom(await button.boundingBox())

    // An iPhone's home indicator: 34px of safe area at the bottom
    const cdp = await browserContext.newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34 } })
    await page.waitForFunction(
      `document.querySelector('[data-testid="primary-action"] button').getBoundingClientRect().bottom < ${plain}`
    )
    // The bar still reaches the bottom; its button moved up by the inset, clear of it
    assert.equal(bottom(await bar.boundingBox()), height)
    const clear = await button.boundingBox()
    assert.isAtMost(bottom(clear), height - 34)
    assert.equal(bottom(clear), plain - 34)
    assert.isAtLeast(clear?.height ?? 0, 44)
  })
})
