import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import Visit from '#models/visit'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'

test.group('Job page summary in the browser (#178)', () => {
  test('the Visits collapse behind their progress, and the summary opens per Visit', async ({
    browserContext,
    visit,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const valve = await createItem({ description: 'Valvola', unit: 'pz' })
    const startsAt = DateTime.fromISO('2026-11-06T09:00')
    const planned = await Visit.create({
      jobId: job.id,
      startsAt,
      endsAt: startsAt.plus({ hours: 2 }),
      status: 'planned',
    })
    await Charge.create({
      jobId: job.id,
      visitId: planned.id,
      kind: 'item',
      itemId: valve.id,
      quantity: '4',
      billQuantity: '4',
      unitPrice: '7.5',
      description: 'Valvola',
    })

    const page = await visit(`/jobs/${job.id}`)
    const edit = page.getByTestId('visits').getByRole('link', { name: it('ui.visits.edit') })
    await page.getByText(it('ui.jobs.progress', { done: 0, total: 1 })).waitFor()
    await page.getByText(it('ui.jobs.progressNext', { when: '06/11/2026 09:00–11:00' })).waitFor()
    await edit.waitFor({ state: 'hidden' })
    await page.getByTestId('visit-progress').click()
    await edit.waitFor()

    const summary = page.getByTestId('charge-summary')
    await summary.getByText('Valvola').click()
    await summary.getByText('06/11/2026 09:00–11:00').waitFor()
  })
})
