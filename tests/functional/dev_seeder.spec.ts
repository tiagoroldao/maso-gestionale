import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import DevSeeder, { DEV_LOGINS } from '#database/seeders/dev_seeder'
import Invoice from '#models/invoice'
import Job from '#models/job'
import Quote, { QUOTE_STATUSES } from '#models/quote'
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
    assert.includeMembers([...statuses], ['open', 'in_progress', 'cancelled'])
    // Quotes in every status, several on one Job
    const quotes = await Quote.all()
    assert.sameMembers([...new Set(quotes.map((quote) => quote.status))], [...QUOTE_STATUSES])
    assert.isTrue(quotes.some((quote) => quote.sequence === 2))
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

    // Today's started boiler Visit and tomorrow's follow-up, and a Survey
    const luca = await User.findByOrFail('email', DEV_LOGINS.technicians[0])
    const mine = await client.get('/my-visits').withInertia().loginAs(luca)
    const lucaVisits = mine.inertiaProps.visits as { status: string; survey: boolean }[]
    assert.sameMembers(
      lucaVisits
        .filter((visit) => visit.status !== 'needs_return' && !visit.survey)
        .map((visit) => visit.status),
      ['in_progress', 'planned']
    )
    assert.lengthOf(
      lucaVisits.filter((visit) => visit.survey),
      1
    )
    // Surveys leave their Jobs open, quoted or not
    const surveyed = await Job.query().whereHas('visits', (visit) => visit.where('survey', true))
    assert.sameMembers(
      surveyed.map((job) => job.status),
      ['open', 'open']
    )

    const agenda = await client.get('/agenda').qs({ view: 'week' }).withInertia().loginAs(office)
    assert.isNotEmpty(agenda.inertiaProps.visits as unknown[])
    const stock = await client.get('/stock').withInertia().loginAs(office)
    const toReorder = stock.inertiaProps.toReorder as { code: string }[]
    assert.deepEqual(
      toReorder.map((item) => item.code),
      ['FLX-30']
    )
  })
})
