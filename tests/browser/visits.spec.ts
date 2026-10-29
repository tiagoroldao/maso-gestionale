import { test } from '@japa/runner'
import Visit from '#models/visit'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'

test.group('Agenda in the browser', () => {
  test('Office plans a Visit, then drags it to another Technician and time', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const anna = await createUser('technician', { fullName: 'Anna Tecnico' })
    const bruno = await createUser('technician', { fullName: 'Bruno Tecnico' })
    const job = await createJob(await createCustomer())

    const form = await visit(`/jobs/${job.id}/visits/create`)
    await form.getByLabel(it('ui.visits.date')).fill('2026-11-03')
    await form.getByLabel(it('ui.visits.startTime')).fill('09:00')
    await form.getByLabel('Anna Tecnico').check()
    await form.getByRole('button', { name: it('ui.visits.plan') }).click()
    await form.waitForURL('**/agenda?date=2026-11-03')

    const card = form.locator('[data-visit]')
    await card.waitFor()
    // The 09:00–11:00 block sits 96px down the grid (07:00 start, 24px per
    // half hour); Playwright grabs it in the middle, 48px in. Dropping at the
    // same height on Bruno's lane hands it over without changing the time.
    await card.dragTo(form.locator(`.agenda__column[data-technician="${bruno.id}"]`), {
      targetPosition: { x: 20, y: 96 + 48 },
    })

    await form.locator(`.agenda__column[data-technician="${bruno.id}"] [data-visit]`).waitFor()
    const moved = await Visit.query().preload('technicians').firstOrFail()
    assert.equal(moved.startsAt.toFormat('HH:mm'), '09:00')
    assert.deepEqual(
      moved.technicians.map((t) => t.id),
      [bruno.id]
    )
    await job.refresh()
    assert.equal(job.status, 'in_progress')
    assert.isFalse(moved.technicians.some((t) => t.id === anna.id))
    assert.isTrue(moved.endsAt.diff(moved.startsAt, 'minutes').minutes === 120)
  })

  test('Office repeats a Visit on weekdays, dropping a public holiday', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    await createUser('technician', { fullName: 'Anna Tecnico' })
    const job = await createJob(await createCustomer())

    const form = await visit(`/jobs/${job.id}/visits/create`)
    await form.getByLabel(it('ui.visits.date')).fill('2026-12-07')
    await form.getByLabel(it('ui.visits.startTime')).fill('09:00')
    await form.getByLabel('Anna Tecnico').check()
    await form.getByLabel(it('ui.visits.repeat')).selectOption('weekdays')
    await form.getByLabel(it('ui.visits.count')).fill('3')
    await form.getByRole('button', { name: it('ui.visits.showDates') }).click()

    // Tuesday 8 December is the Immacolata
    await form
      .getByText(it('ui.visits.holiday', { name: it('ui.visits.holidays.immaculate') }))
      .waitFor()
    await form.getByLabel('08/12/2026').uncheck()
    await form.getByRole('button', { name: it('ui.visits.planDates') }).click()
    await form.waitForURL('**/agenda?date=2026-12-07&view=week')

    const visits = await Visit.query().where('jobId', job.id).orderBy('startsAt')
    assert.deepEqual(
      visits.map((planned) => planned.startsAt.toFormat("yyyy-MM-dd'T'HH:mm")),
      ['2026-12-07T09:00', '2026-12-09T09:00']
    )
  })
})
