import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Visit from '#models/visit'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'

test.group('Technician screens in the browser', () => {
  test('on a phone, a Technician marks a Visit done and leaves a note', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const anna = await createUser('technician')
    await browserContext.loginAs(anna)
    const job = await createJob(await createCustomer({ name: 'Condominio Verdi' }))
    const start = DateTime.now().plus({ hours: 1 })
    const planned = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 1 }),
      status: 'planned',
    })
    await planned.related('technicians').attach([anna.id])

    const page = await visit('/my-visits')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('link', { name: /Condominio Verdi/ }).click()
    await page.getByRole('button', { name: it('ui.visits.statuses.done') }).click()
    await page.getByRole('button', { name: it('ui.visits.statuses.done'), pressed: true }).waitFor()
    await page.getByLabel(it('ui.field.addNote')).fill('Sostituita la guarnizione')
    await page.getByRole('button', { name: it('ui.field.saveNote') }).click()
    await page.getByText('Sostituita la guarnizione').waitFor()

    await planned.refresh()
    assert.equal(planned.status, 'done')
  })
})
