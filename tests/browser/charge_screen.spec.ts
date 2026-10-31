import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import LabourRate from '#models/labour_rate'
import Visit from '#models/visit'
import Charges from '#services/charges'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

/**
 * The Charge as an Entity screen in edit mode under its Job (#279):
 * docs/ui.md's rules where they depend on the screen size, the header's
 * actions for its states, and its accessibility.
 */
test.group('Charge screen in the browser', () => {
  test('on a phone, a billed Charge keeps Save held with its reason; set back to bill asks first', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await completeCompany()
    const office = await createUser('office')
    await browserContext.loginAs(office)
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const charge = await Charges.add(
      job,
      {
        description: 'Collaboratore esterno',
        quantity: '8',
        unit: 'h',
        unitPrice: '30',
        vatKind: 'labour',
      },
      office
    )
    const draft = await Invoices.fromJob(job)
    await Invoices.finalise(draft)
    const invoice = await Invoice.findOrFail(draft.id)

    const page = await visit(`/charges/${charge.id}/edit`)
    await page.setViewportSize(SCREEN_SIZES.phone)

    // "‹" goes back to the Job, the Charge's canonical parent
    await page.getByRole('link', { name: it('ui.screen.back', { label: job.number }) }).waitFor()
    await page.getByTestId('charge-state').getByText(it('ui.charges.states.billed')).waitFor()

    const bar = page.getByTestId('primary-action')
    const save = bar.getByRole('button', { name: it('ui.charges.saveBilling') })
    assert.isTrue(await save.isDisabled())
    await bar.getByText(it('ui.charges.billingHeld.billed')).waitFor()
    assert.isTrue(await page.getByLabel(it('ui.charges.unitPrice')).isDisabled())
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    const header = page.locator('main header')
    await header.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    const items = await page.getByRole('menuitem').allTextContents()
    assert.deepEqual(
      items.map((item) => item.trim()),
      [it('ui.charges.setBackToBill')]
    )
    await page.getByRole('menuitem', { name: it('ui.charges.setBackToBill') }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog
      .getByText(it('ui.charges.setBackToBillConfirm', { number: invoice.formattedNumber! }))
      .waitFor()
    await dialog.getByRole('button', { name: it('ui.charges.setBackToBill') }).click()

    await page.getByText(it('flash.chargeSetBackToBill')).waitFor()
    await page.getByTestId('charge-state').getByText(it('ui.charges.states.to_bill')).waitFor()
    assert.isFalse(await save.isDisabled())
  })

  test('on a desktop, the breadcrumb runs Commesse / the Job / the Charge, the work state beside Save', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const anna = await createUser('technician', { fullName: 'Anna' })
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const start = DateTime.now().minus({ days: 1 })
    const done = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'in_progress',
    })
    await done.related('technicians').attach([anna.id])
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
    const charge = await FieldWork.recordHours(
      done,
      { technicianId: anna.id, labourRateId: rate.id, hours: '2' },
      anna
    )
    await FieldWork.setStatus(done, 'done', anna)

    const page = await visit(`/charges/${charge.id}/edit`)
    await page.setViewportSize(SCREEN_SIZES.desktop)

    const breadcrumb = page.getByRole('navigation', { name: it('ui.screen.breadcrumb') })
    await breadcrumb.getByRole('link', { name: it('ui.jobs.title') }).waitFor()
    await breadcrumb.getByRole('link', { name: job.number }).waitFor()
    await breadcrumb.getByText('Idraulico – Anna').waitFor()

    // Secondary, then the primary, then "⋯"
    const header = page.locator('main header')
    const notDone = await header
      .getByRole('button', { name: it('ui.charges.markNotDone') })
      .boundingBox()
    const save = await header
      .getByRole('button', { name: it('ui.charges.saveBilling') })
      .boundingBox()
    const more = await header
      .getByRole('button', { name: it('ui.screen.moreActions') })
      .boundingBox()
    assert.isBelow(notDone!.x, save!.x)
    assert.isBelow(save!.x, more!.x)
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [])

    // Enter in a billing field saves, as Save would
    await page.getByLabel(it('ui.charges.unitPrice')).fill('35')
    await page.getByLabel(it('ui.charges.unitPrice')).press('Enter')
    await page.getByText(it('flash.chargeBillingSaved')).waitFor()

    await header.getByRole('button', { name: it('ui.charges.markNotDone') }).click()
    await page.getByText(it('flash.chargeWork.not_done')).waitFor()
    await page
      .getByTestId('charge-work-state')
      .getByText(it('ui.charges.workStates.not_done'))
      .waitFor()
    await header.getByRole('button', { name: it('ui.charges.markDone') }).waitFor()
    await charge.refresh()
    assert.equal(charge.unitPrice, '35.0000')
  })
})
