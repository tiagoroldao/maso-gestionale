import { test } from '@japa/runner'
import Charge from '#models/charge'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

// Once it has slid in (a string: the tests' types have no DOM)
const SLID_IN =
  "document.querySelector('[data-testid=record-preview]')?.getAnimations().length === 0"

/**
 * An Item in a Job's Charges opens its preview over the Job (#236,
 * docs/ui.md "Hierarchy and references"): a side panel on desktop, a
 * bottom sheet on the phone.
 */
test.group('Item preview in the browser', () => {
  async function jobWithAValve() {
    const job = await createJob(await createCustomer())
    const valve = await createItem({ code: 'VAL-01', description: 'Valvola a sfera', unit: 'pz' })
    await Charge.create({
      jobId: job.id,
      kind: 'item',
      itemId: valve.id,
      quantity: '2',
      billQuantity: '2',
      unitPrice: '7.5',
      description: 'Valvola a sfera',
    })
    return { job, valve }
  }

  test('on a desktop, the Item opens in a side panel; Esc closes it and leaves the Job as it was', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { job, valve } = await jobWithAValve()

    const page = await visit(`/jobs/${job.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)
    const opener = page.getByRole('button', { name: 'Valvola a sfera' })
    await opener.click()

    const preview = page.getByRole('dialog', { name: 'Valvola a sfera' })
    await preview.getByText('VAL-01').waitFor()
    await preview.getByText(it('ui.items.available')).waitFor()
    const openPage = preview.getByRole('link', { name: it('ui.screen.preview.openPage') })
    assert.equal(await openPage.getAttribute('href'), `/items/${valve.id}`)

    // On the right, full height, once it has slid in
    await page.waitForFunction(SLID_IN)
    const box = await preview.boundingBox()
    assert.equal(Math.round(box!.x + box!.width), SCREEN_SIZES.desktop.width)
    assert.equal(Math.round(box!.height), SCREEN_SIZES.desktop.height)
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    await page.keyboard.press('Escape')
    await preview.waitFor({ state: 'detached' })
    assert.isTrue(page.url().endsWith(`/jobs/${job.id}`))
    assert.equal(await page.locator('button:focus').textContent(), 'Valvola a sfera')
  })

  test('on a phone, the Item opens in a bottom sheet that keeps focus; "Apri scheda" opens its page', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { job, valve } = await jobWithAValve()

    const page = await visit(`/jobs/${job.id}`)
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.getByRole('button', { name: 'Valvola a sfera' }).click()

    const preview = page.getByRole('dialog', { name: 'Valvola a sfera' })
    await preview.getByText('VAL-01').waitFor()

    // At the bottom, full width, once it has slid in
    await page.waitForFunction(SLID_IN)
    const box = await preview.boundingBox()
    assert.equal(Math.round(box!.y + box!.height), SCREEN_SIZES.phone.height)
    assert.equal(Math.round(box!.width), SCREEN_SIZES.phone.width)
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    // Focus stays inside while it is open
    for (let step = 0; step < 4; step++) {
      await page.keyboard.press('Tab')
      assert.equal(await preview.locator(':focus').count(), 1, `tab ${step}`)
    }

    // "Chiudi" goes back to the Job; "Apri scheda" to the Item
    await preview.getByRole('button', { name: it('ui.screen.closeDialog') }).click()
    await preview.waitFor({ state: 'detached' })
    assert.isTrue(page.url().endsWith(`/jobs/${job.id}`))

    await page.getByRole('button', { name: 'Valvola a sfera' }).click()
    await preview.getByRole('link', { name: it('ui.screen.preview.openPage') }).click()
    await page.waitForURL(`**/items/${valve.id}`)
    await page.getByRole('dialog').waitFor({ state: 'detached' })
  })

  test("on a phone, the bottom sheet keeps its buttons clear of the iPhone's home indicator (#311)", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { job } = await jobWithAValve()

    const page = await visit(`/jobs/${job.id}`)
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page.getByRole('button', { name: 'Valvola a sfera' }).click()
    const preview = page.getByRole('dialog', { name: 'Valvola a sfera' })
    const openPage = preview.getByRole('link', { name: it('ui.screen.preview.openPage') })
    await openPage.waitFor()
    await page.waitForFunction(SLID_IN)
    const gapBelow = async () => {
      const box = await openPage.boundingBox()
      return Math.round(SCREEN_SIZES.phone.height - ((box?.y ?? 0) + (box?.height ?? 0)))
    }
    const plain = await gapBelow()

    // An iPhone's home indicator: 34px of safe area at the bottom
    const cdp = await browserContext.newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34 } })
    // Waits on the link it asserts on (types without a DOM: `any`)
    await page.waitForFunction(
      ({ el, was }: any) =>
        (globalThis as any).innerHeight - el.getBoundingClientRect().bottom > was,
      { el: await openPage.elementHandle(), was: plain }
    )
    // The sheet still reaches the bottom; its buttons moved up by the inset, clear of it
    const box = await preview.boundingBox()
    assert.equal(Math.round(box!.y + box!.height), SCREEN_SIZES.phone.height)
    const clear = await gapBelow()
    assert.isAtLeast(clear, 34)
    assert.equal(clear, plain + 34)
  })

  test("on a sideways phone, the side panel keeps its buttons clear of the iPhone's home indicator (#326)", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { job } = await jobWithAValve()

    const page = await visit(`/jobs/${job.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page.getByRole('button', { name: 'Valvola a sfera' }).click()
    const preview = page.getByRole('dialog', { name: 'Valvola a sfera' })
    const openPage = preview.getByRole('link', { name: it('ui.screen.preview.openPage') })
    await openPage.waitFor()
    await page.waitForFunction(SLID_IN)
    const gapBelow = async () => {
      const box = await openPage.boundingBox()
      return Math.round(SCREEN_SIZES.desktop.height - ((box?.y ?? 0) + (box?.height ?? 0)))
    }
    const plain = await gapBelow()

    const cdp = await browserContext.newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34 } })
    await page.waitForFunction(
      ({ el, was }: any) =>
        (globalThis as any).innerHeight - el.getBoundingClientRect().bottom > was,
      { el: await openPage.elementHandle(), was: plain }
    )
    const clear = await gapBelow()
    assert.isAtLeast(clear, 34)
    assert.equal(clear, plain + 34)
  })

  test('when the Item fails to load, "Riprova" loads it again', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { job } = await jobWithAValve()

    const page = await visit(`/jobs/${job.id}`)
    // The first load fails, the next goes through
    await page.route('**/items/*/preview', (route) => route.fulfill({ status: 500 }), { times: 1 })
    await page.getByRole('button', { name: 'Valvola a sfera' }).click()

    const preview = page.getByRole('dialog')
    await preview.getByText(it('ui.screen.preview.failed')).waitFor()
    await preview.getByRole('button', { name: it('ui.screen.preview.retry') }).click()
    await page.getByRole('dialog', { name: 'Valvola a sfera' }).getByText('VAL-01').waitFor()
    // Focus stayed in the panel, on its title, while "Riprova" went away
    assert.equal(await page.getByRole('dialog').locator(':focus').count(), 1)
  })
})
