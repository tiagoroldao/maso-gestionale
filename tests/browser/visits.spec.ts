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
    const job = await createJob(await createCustomer(), { kind: 'time_and_materials' })

    const form = await visit(`/jobs/${job.id}/visits/create`)
    await form.getByLabel(it('ui.visits.date')).fill('2026-11-03')
    await form.getByLabel(it('ui.visits.startTime')).fill('09:00')
    await form.getByLabel('Anna Tecnico').check()
    await form.getByRole('button', { name: it('ui.visits.plan') }).click()
    await form.waitForURL('**/agenda?date=2026-11-03')

    const card = form.locator('[data-visit]')
    await card.waitFor()
    // Half-hour slots of 24px from 07:00: 13:00 is slot 12
    await card.dragTo(form.locator(`.agenda__column[data-technician="${bruno.id}"]`), {
      targetPosition: { x: 20, y: 12 * 24 + 5 },
    })

    await form.locator(`.agenda__column[data-technician="${bruno.id}"] [data-visit]`).waitFor()
    const moved = await Visit.query().preload('technicians').firstOrFail()
    assert.equal(moved.startsAt.toFormat('HH:mm'), '13:00')
    assert.deepEqual(
      moved.technicians.map((t) => t.id),
      [bruno.id]
    )
    await job.refresh()
    assert.equal(job.status, 'in_progress')
    assert.isFalse(moved.technicians.some((t) => t.id === anna.id))
    assert.isTrue(moved.endsAt.diff(moved.startsAt, 'minutes').minutes === 120)
  })
})
