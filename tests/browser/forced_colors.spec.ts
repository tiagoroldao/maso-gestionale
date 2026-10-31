import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * Windows high-contrast (forced colours) removes box-shadows, which draw
 * the focus rings: keyboard focus must still show, as an outline (#320).
 * On the component gallery's samples (/dev/ui).
 */
test.group('Focus in forced colours in the browser', () => {
  test('focus stays visible on fields, selects (also the wrapped one) and buttons (#320)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const page = await visit('/dev/ui')
    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page.emulateMedia({ forcedColors: 'active' })

    const controls = {
      'field': page.locator('#gallery-empty'),
      'textarea': page.locator('#gallery-textarea'),
      'select': page.locator('#gallery-select'),
      'wrapped select': page.locator('#gallery-wrapped-select'),
      'button': page.getByRole('button', { name: it('ui.devUi.action.secondary') }).first(),
    }
    for (const [name, control] of Object.entries(controls)) {
      await control.focus()
      const outline = await control.evaluate((el) => {
        const style = getComputedStyle(el)
        return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
      })
      assert.notEqual(outline.style, 'none', name)
      assert.isAbove(outline.width, 0, name)
    }
  })
})
