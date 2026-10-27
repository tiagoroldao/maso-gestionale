import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import DevSeeder, { DEV_LOGINS } from '#database/seeders/dev_seeder'
import Invoice from '#models/invoice'
import Job from '#models/job'
import User from '#models/user'
import Visit from '#models/visit'
import StockLedger from '#stock/stock_ledger'
import Item from '#models/item'

test.group('Development seed data', () => {
  test('fills a fresh database with every role, status and screen populated', async ({
    client,
    assert,
  }) => {
    await new DevSeeder(db.connection()).run()

    const users = await User.all()
    const roles = users.map((user) => user.role).sort()
    assert.deepEqual(roles, ['admin', 'office', 'superuser', 'technician', 'technician'])

    const jobs = await Job.all()
    const statuses = new Set(jobs.map((job) => job.status))
    assert.includeMembers([...statuses], ['open', 'quoted', 'accepted', 'in_progress', 'cancelled'])
    const allVisits = await Visit.all()
    const visits = new Set(allVisits.map((visit) => visit.status))
    assert.includeMembers([...visits], ['planned', 'in_progress', 'done', 'needs_return'])
    assert.lengthOf(await Invoice.all(), 1)

    // Items used on the done Visit came off stock
    const raccordo = await Item.findByOrFail('code', 'RAC-T12')
    assert.equal(await StockLedger.levelOf(raccordo), '194.000')

    const office = await User.findByOrFail('email', DEV_LOGINS.office)
    const toSchedule = await client.get('/agenda/to-schedule').withInertia().loginAs(office)
    assert.lengthOf(toSchedule.inertiaProps.visits as unknown[], 1)
    const complete = await client
      .get('/jobs')
      .qs({ status: 'work_complete' })
      .withInertia()
      .loginAs(office)
    assert.lengthOf(complete.inertiaProps.jobs as unknown[], 1)

    const luca = await User.findByOrFail('email', DEV_LOGINS.technicians[0])
    const mine = await client.get('/my-visits').withInertia().loginAs(luca)
    assert.isNotEmpty(mine.inertiaProps.visits as unknown[])
  })
})
