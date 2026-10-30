import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Visit from '#models/visit'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'
import { chooseMoreAction } from '#tests/helpers/screen'

test.group('Visits left open on a cancelled Job in the browser', () => {
  test('cancelling lists the open Visit, then Office marks it done', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const startsAt = DateTime.fromISO('2026-10-03T09:00')
    const open = await Visit.create({
      jobId: job.id,
      startsAt,
      endsAt: startsAt.plus({ hours: 2 }),
      status: 'planned',
    })

    const page = await visit(`/jobs/${job.id}`)
    // Cancelling is destructive: the question names the Visit left open
    await chooseMoreAction(page, it('ui.jobs.cancel'))
    const question = page.getByRole('alertdialog')
    assert.include(await question.textContent(), '03/10/2026 09:00–11:00')
    await question.getByRole('button', { name: it('ui.jobs.cancel') }).click()
    await page.getByRole('button', { name: it('ui.visits.markDone') }).waitFor()

    // Marking it done is final, so it asks too
    await page.getByRole('button', { name: it('ui.visits.markDone') }).click()
    await question.getByText(it('ui.visits.markDoneConfirm')).waitFor()
    await question.getByRole('button', { name: it('ui.visits.markDone') }).click()
    await page.getByText(it('flash.visitMarkedDone')).waitFor()
    await open.refresh()
    assert.equal(open.status, 'done')
  })
})
