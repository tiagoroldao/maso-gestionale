import { test } from '@japa/runner'
import Invoice from '#models/invoice'
import Visit from '#models/visit'
import { DateTime } from 'luxon'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Payments from '#services/payments'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { chooseMoreAction, holdSave } from '#tests/helpers/screen'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/** A line's error on its description, as the line shows it */
const DESCRIPTION_ERROR = it('ui.common.fieldError', {
  field: it('ui.invoices.description'),
  message: '',
})

/**
 * The Invoice as an Entity screen (#241): docs/ui.md's rules where they
 * depend on the screen size, the Item preview from a line, the
 * confirmations, and its accessibility.
 */
test.group('Invoice screen in the browser', (group) => {
  group.each.setup(async () => {
    await completeCompany()
  })

  /** A direct sale of a valve */
  async function draftWithAValve() {
    const valve = await createItem({ code: 'VAL-01', description: 'Valvola a sfera', unit: 'pz' })
    const invoice = await Invoices.create(await createCustomer({ name: 'Bar Centrale' }))
    const standard = await vatCode()
    await Invoices.save(invoice, {
      lines: [
        {
          itemId: valve.id,
          description: 'Valvola a sfera',
          quantity: '2',
          unitPrice: '7.5',
          vatCodeId: standard.id,
        },
      ],
    })
    return { invoice, valve }
  }

  /** A Job's draft billing the valve and the pipe a done Visit used, a line each */
  async function draftOfAValveAndAPipe() {
    const anna = await createUser('technician', { fullName: 'Anna' })
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const start = DateTime.fromISO('2026-10-05T09:00')
    const done = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'planned',
    })
    await done.related('technicians').attach([anna.id])
    for (const description of ['Valvola', 'Tubo']) {
      const item = await createItem({ description, resalePrice: '5' })
      await FieldWork.recordItem(done, { itemId: item.id, quantity: '1' })
    }
    await FieldWork.setStatus(done, 'done', anna)
    return Invoices.fromJob(job, { organiseBy: 'none' })
  }

  test('on a phone, finalising is in the bar at the bottom, Save in the header, deleting in "⋯"', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page
      .getByRole('link', { name: it('ui.screen.back', { label: it('ui.invoices.title') }) })
      .waitFor()

    const bar = page.getByTestId('primary-action')
    await bar.getByRole('button', { name: it('ui.invoices.finalise') }).waitFor()
    const box = await bar.boundingBox()
    assert.equal(Math.round((box?.y ?? 0) + (box?.height ?? 0)), SCREEN_SIZES.phone.height)

    const header = page.locator('main header')
    await header.getByRole('button', { name: it('ui.invoices.save') }).waitFor()
    await header.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    const items = await page.getByRole('menuitem').allTextContents()
    assert.deepEqual(
      items.map((item) => item.trim()),
      [it('ui.invoices.delete')]
    )
    await page.keyboard.press('Escape')

    // Unsaved edits hold finalising back, with the reason beside it
    await page.getByLabel(it('ui.invoices.quantityOf', { position: 1 })).fill('3')
    await page.getByTestId('invoice-total').getByText('27,45 €').waitFor()
    await bar.getByText(it('ui.invoices.saveFirst')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])
  })

  test('on a desktop, the header reads Save, finalise, "⋯", and Enter in a line saves', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.setViewportSize(SCREEN_SIZES.desktop)
    const breadcrumb = page.getByRole('navigation', { name: it('ui.screen.breadcrumb') })
    await breadcrumb.getByRole('link', { name: it('ui.invoices.title') }).waitFor()

    const header = page.locator('main header')
    const save = await header.getByRole('button', { name: it('ui.invoices.save') }).boundingBox()
    const finalise = await header
      .getByRole('button', { name: it('ui.invoices.finalise') })
      .boundingBox()
    const more = await header
      .getByRole('button', { name: it('ui.screen.moreActions') })
      .boundingBox()
    assert.isBelow(save!.x, finalise!.x)
    assert.isBelow(finalise!.x, more!.x)
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    const quantity = page.getByLabel(it('ui.invoices.quantityOf', { position: 1 }))
    await quantity.fill('5')
    await page.getByText(it('ui.invoices.unsaved')).waitFor()
    await quantity.press('Enter')
    await page.getByText(it('flash.invoiceSaved')).waitFor()
    await invoice.load('lines')
    assert.equal(Number(invoice.lines[0].quantity), 5)
  })

  test("an Item on a line opens its preview over the Invoice, which keeps the line's edits", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice, valve } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.getByLabel(it('ui.invoices.quantityOf', { position: 1 })).fill('4')
    await page
      .getByRole('button', { name: it('ui.invoices.previewItemOf', { position: 1 }) })
      .click()
    const preview = page.getByRole('dialog', { name: 'Valvola a sfera' })
    await preview.getByText('VAL-01').waitFor()
    const openPage = preview.getByRole('link', { name: it('ui.screen.preview.openPage') })
    assert.equal(await openPage.getAttribute('href'), `/items/${valve.id}`)

    await page.keyboard.press('Escape')
    await preview.waitFor({ state: 'detached' })
    assert.equal(
      await page.getByLabel(it('ui.invoices.quantityOf', { position: 1 })).inputValue(),
      '4'
    )
  })

  test('removing a line after a refused save leaves each line its own errors (#289)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    const addFreeLine = page.getByRole('button', { name: it('ui.invoices.addFreeLine') })
    const line = (position: number) =>
      page.getByRole('listitem', { name: it('ui.invoices.lineOf', { position }) })
    const descriptionError = it('ui.common.fieldError', {
      field: it('ui.invoices.description'),
      message: '',
    })
    const descriptionOf = (position: number) =>
      page.getByLabel(it('ui.invoices.descriptionOf', { position }))

    // Refused: the free line, second, has no description
    await addFreeLine.click()
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await line(2).getByText(descriptionError).waitFor()
    assert.equal(await line(1).getByText(descriptionError).count(), 0)

    // The valve removed: the free line, now first, keeps its error
    await line(1)
      .getByRole('button', { name: it('ui.invoices.removeLine') })
      .click()
    assert.equal(
      await page
        .getByRole('listitem', { name: it('ui.invoices.lineOf', { position: '' }) })
        .count(),
      1
    )
    await line(1).getByText(descriptionError).waitFor()
    assert.equal(await descriptionOf(1).getAttribute('aria-invalid'), 'true')

    // A line added since has none
    await addFreeLine.click()
    await line(2).waitFor()
    assert.equal(await line(2).getByText(descriptionError).count(), 0)
    assert.isNull(await descriptionOf(2).getAttribute('aria-invalid'))
  })

  test("moving a line after a refused save takes its errors along; a save in flight doesn't move them (#292)", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    const line = (position: number) =>
      page.getByRole('listitem', { name: it('ui.invoices.lineOf', { position }) })
    const hasError = async (position: number) =>
      (await line(position).getByText(DESCRIPTION_ERROR).count()) === 1

    // Refused: the free line, second, has no description
    await page.getByRole('button', { name: it('ui.invoices.addFreeLine') }).click()
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await line(2).getByText(DESCRIPTION_ERROR).waitFor()

    // Up, first: its error goes with it; down again, back to second
    await line(2)
      .getByRole('button', { name: it('ui.invoices.moveUp') })
      .click()
    await line(1).getByText(DESCRIPTION_ERROR).waitFor()
    assert.isFalse(await hasError(2))
    assert.equal(
      await page
        .getByLabel(it('ui.invoices.descriptionOf', { position: 1 }))
        .getAttribute('aria-invalid'),
      'true'
    )
    await line(1)
      .getByRole('button', { name: it('ui.invoices.moveDown') })
      .click()
    await line(2).getByText(DESCRIPTION_ERROR).waitFor()
    assert.isFalse(await hasError(1))

    // Up again and saved, held: until its answer the error stays where it is
    await line(2)
      .getByRole('button', { name: it('ui.invoices.moveUp') })
      .click()
    await line(1).getByText(DESCRIPTION_ERROR).waitFor()
    const save = await holdSave(page, {
      method: 'PUT',
      path: `/invoices/${invoice.id}`,
      answeredBy: `/invoices/${invoice.id}/edit`,
    })
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await save.sent
    assert.isTrue(await hasError(1))
    assert.isFalse(await hasError(2))
    save.answer()
    await save.answered
    await line(1).getByText(DESCRIPTION_ERROR).waitFor()
    assert.isFalse(await hasError(2))
  })

  test("moving or removing a section after a refused save takes its title's error along (#292)", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    const title = (position: number) =>
      page.getByLabel(it('ui.invoices.sectionTitleOf', { position }))
    const section = (position: number) => page.getByTestId('invoice-section').nth(position - 1)
    const titleError = (position: number) =>
      it('ui.common.fieldError', {
        field: it('ui.invoices.sectionTitleOf', { position }),
        message: '',
      })
    const shows = async (position: number) => ({
      invalid: await title(position).getAttribute('aria-invalid'),
      errors: await section(position).getByText(titleError(position)).count(),
    })

    // Refused: the first of two sections has no title
    const addSection = page.getByRole('button', { name: it('ui.invoices.addSection') })
    await addSection.click()
    await addSection.click()
    await title(1).fill('')
    await title(2).fill('Materiali')
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await section(1).getByText(titleError(1)).waitFor()
    assert.deepEqual(await shows(2), { invalid: null, errors: 0 })

    // Moved down, second: its error goes with it
    await section(1)
      .getByRole('button', { name: it('ui.invoices.moveSectionDown') })
      .click()
    assert.equal(await title(1).inputValue(), 'Materiali')
    await section(2).getByText(titleError(2)).waitFor()
    assert.deepEqual(await shows(2), { invalid: 'true', errors: 1 })
    assert.deepEqual(await shows(1), { invalid: null, errors: 0 })

    // The one above removed: first again, it keeps its error
    await section(1)
      .getByRole('button', { name: it('ui.invoices.removeSection') })
      .click()
    assert.equal(await page.getByTestId('invoice-section').count(), 1)
    await section(1).getByText(titleError(1)).waitFor()
    assert.deepEqual(await shows(1), { invalid: 'true', errors: 1 })

    // A section added since has none
    await addSection.click()
    await title(2).waitFor()
    assert.deepEqual(await shows(2), { invalid: null, errors: 0 })
  })

  test("a line merged into, after a refused save, loses the errors of the fields merging rewrote, not the others' (#292)", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const invoice = await draftOfAValveAndAPipe()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    const line = (position: number) =>
      page.getByRole('listitem', { name: it('ui.invoices.lineOf', { position }) })
    const description = page.getByLabel(it('ui.invoices.descriptionOf', { position: 1 }))
    const discount = page.getByLabel(it('ui.invoices.lineDiscountOf', { position: 1 }))
    const discountError = it('ui.common.fieldError', {
      field: it('ui.invoices.lineDiscount'),
      message: '',
    })

    // Refused: the first line has no description and a discount over 100%
    await description.fill('')
    await discount.fill('150')
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await line(1).getByText(DESCRIPTION_ERROR).waitFor()
    await line(1).getByText(discountError).waitFor()

    // The second merged into it: the discount is written anew, its error
    // gone; the description is kept as it was, and so is its error
    await line(2)
      .getByRole('button', { name: it('ui.invoices.mergeUp') })
      .click()
    await line(2).waitFor({ state: 'detached' })
    assert.equal(await discount.inputValue(), '')
    assert.equal(await line(1).getByText(discountError).count(), 0)
    assert.isNull(await discount.getAttribute('aria-invalid'))
    assert.equal(await line(1).getByText(DESCRIPTION_ERROR).count(), 1)
    assert.equal(await description.getAttribute('aria-invalid'), 'true')
  })

  test('a line folded into, after a refused save, shows no stale errors (#292)', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const invoice = await draftOfAValveAndAPipe()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    const line = (position: number) =>
      page.getByRole('listitem', { name: it('ui.invoices.lineOf', { position }) })
    const description = page.getByLabel(it('ui.invoices.descriptionOf', { position: 1 }))

    // Refused: the first line has no description
    await description.fill('')
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await line(1).getByText(DESCRIPTION_ERROR).waitFor()

    // Folded: one consumables line, described anew, with no errors
    await page.getByRole('button', { name: it('ui.invoices.foldConsumables') }).click()
    await line(2).waitFor({ state: 'detached' })
    assert.equal(await description.inputValue(), it('documents.invoice.consumablesLine'))
    assert.equal(await line(1).getByText(DESCRIPTION_ERROR).count(), 0)
    assert.isNull(await description.getAttribute('aria-invalid'))
  })

  test("on a tablet, a line's fields keep one row under their heads", async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.setViewportSize(SCREEN_SIZES.tablet)
    const box = (label: string) => page.getByLabel(label).boundingBox()
    const description = await box(it('ui.invoices.descriptionOf', { position: 1 }))
    const vat = await box(it('ui.invoices.vatCodeOf', { position: 1 }))
    assert.equal(Math.round(vat!.y), Math.round(description!.y))
    assert.isAtLeast(description!.width, 128)
  })

  test('deleting a draft asks first, in the confirmation dialog', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await chooseMoreAction(page, it('ui.invoices.delete'))
    const confirm = page.getByRole('alertdialog')
    await confirm.getByText(it('ui.invoices.deleteConfirm')).waitFor()
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'confirmation')
    await confirm.getByRole('button', { name: it('ui.invoices.delete') }).click()
    await page.waitForURL(/\/invoices$/)
    assert.isNull(await Invoice.find(invoice.id))
  })

  test('an issued Invoice reads as text, its PDF opening in a new tab, in dark too', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()
    await Invoices.finalise(invoice)

    const page = await visit(`/invoices/${invoice.id}/edit`)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
    for (const size of ['desktop', 'phone'] as const) {
      await page.setViewportSize(SCREEN_SIZES[size])
      await page
        .getByTestId('primary-action')
        .getByRole('button', { name: it('ui.invoices.prepareSubmission') })
        .waitFor()
      assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], size)
    }
    const pdf = page.locator('main header').getByRole('link', { name: it('ui.invoices.pdf') })
    assert.equal(await pdf.getAttribute('href'), `/invoices/${invoice.id}/pdf`)
    assert.equal(await pdf.getAttribute('target'), '_blank')
    assert.equal(await page.getByLabel(it('ui.invoices.quantityOf', { position: 1 })).count(), 0)
    await page.getByText('Valvola a sfera').waitFor()
  })

  test('an overpaid Invoice says by how much, never a negative amount to collect', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { invoice } = await draftWithAValve()
    await Invoices.finalise(invoice)
    // 15 + 22% VAT = 18.30, paid 20
    await Payments.record(invoice, { amount: '20', paidOn: DateTime.now() })

    const page = await visit(`/invoices/${invoice.id}/edit`)
    const facts = page.getByLabel(it('ui.screen.keyFacts'))
    await facts
      .getByText(it('ui.invoices.overpaidBy', { paid: '20,00 €', amount: '1,70 €' }))
      .waitFor()
    const owedLabel = it('ui.invoices.owedHint', { amount: '' }).trim()
    assert.equal(await facts.getByText(owedLabel).count(), 0)
  })
})
