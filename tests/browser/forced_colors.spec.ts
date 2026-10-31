import { test } from '@japa/runner'
import type { Locator } from 'playwright'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
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

    // The focused control, and what shows its focus: itself, except the
    // wrapped select, whose real <select> is unseen over a box drawn in its place
    const focusable = (control: Locator, shown = 'self') => ({ control, shown })
    const controls = {
      'field': focusable(page.locator('#gallery-empty')),
      'textarea': focusable(page.locator('#gallery-textarea')),
      'select': focusable(page.locator('#gallery-select')),
      'wrapped select': focusable(page.locator('#gallery-wrapped-select'), 'nextElementSibling'),
      'button': focusable(
        page.getByRole('button', { name: it('ui.devUi.action.secondary') }).first()
      ),
    }
    for (const [name, { control, shown }] of Object.entries(controls)) {
      await control.focus()
      // A string: the tests' types have no DOM
      const outline: { style: string; width: number } = await page.evaluate(
        `(() => { const el = document.activeElement; const box = ${shown === 'self' ? 'el' : `el.${shown}`}; const s = getComputedStyle(box); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) } })()`
      )
      assert.notEqual(outline.style, 'none', name)
      assert.isAbove(outline.width, 0, name)
    }
  })

  test("a menu's container, which holds focus while its items are navigated, draws no outline (#326)", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer())
    const page = await visit(`/jobs/${job.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page.emulateMedia({ forcedColors: 'active' })

    // Opened with the pointer, the menu's container takes focus; a key press then makes it visible
    await page.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    const menu = page.getByRole('menu')
    await page.waitForFunction(
      (el: any) => (globalThis as any).document.activeElement === el,
      await menu.elementHandle()
    )
    await page.keyboard.press('Shift')
    const outline = (locator: Locator) =>
      locator.evaluate((el: any) => (globalThis as any).getComputedStyle(el).outlineStyle)
    assert.equal(await outline(menu), 'none')
    // Arrowing into an item: that item shows its focus, not the container
    await page.keyboard.press('ArrowDown')
    assert.equal(await outline(menu), 'none')
    assert.notEqual(await outline(menu.locator(':focus')), 'none')
  })
})
