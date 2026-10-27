import { test } from '@japa/runner'
import Job from '#models/job'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { it } from '#tests/helpers/i18n'

test.group('Jobs in the browser', () => {
  test('Office opens a Job from a Customer, picking one of their Sites', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer({ name: 'Condominio Verdi' })
    const site = await createSite({ label: 'Centrale termica' })
    await customer.related('sites').attach([site.id])

    const page = await visit(`/customers/${customer.id}`)
    await page.getByRole('link', { name: it('ui.jobs.newForCustomer') }).click()
    await page.getByLabel(it('ui.jobs.jobTitle')).fill('Sostituzione caldaia')
    await page.getByRole('option', { name: /Centrale termica/ }).click()
    assert.equal(await page.getByLabel(it('ui.jobs.jobTitle')).inputValue(), 'Sostituzione caldaia')
    await page.getByRole('button', { name: it('ui.jobs.create') }).click()

    await page.waitForURL(/\/jobs\/\d+$/)
    const job = await Job.firstOrFail()
    assert.equal(job.customerId, customer.id)
    assert.equal(job.siteId, site.id)
    await page.getByText(it('ui.jobs.statuses.open'), { exact: true }).waitFor()
  })
})
