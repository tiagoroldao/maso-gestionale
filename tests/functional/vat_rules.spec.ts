import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import VatCode from '#models/vat_code'
import VatRule from '#models/vat_rule'
import VatDefaults from '#services/vat_defaults'
import Invoices from '#services/invoices'
import { CUSTOMER_TYPES } from '#models/customer'
import { WORK_CATEGORIES } from '#shared/jobs'
import { LINE_KINDS } from '#shared/vat'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

/**
 * The seed as the issue states it (#26), written out independently.
 */
function expectedSeed(customerType: string, workCategory: string, residential: boolean) {
  const home = customerType !== 'company' && residential
  if (home && ['maintenance', 'renovation'].includes(workCategory)) return '10%'
  if (customerType === 'company' && workCategory !== 'sale') return 'N6.7'
  return '22%'
}

test.group('Default VAT rules', () => {
  test('every combination is seeded with our reading of the law', async ({ assert }) => {
    const rules = await VatRule.query().preload('vatCode')
    assert.lengthOf(rules, CUSTOMER_TYPES.length * WORK_CATEGORIES.length * 2 * LINE_KINDS.length)

    for (const customerType of CUSTOMER_TYPES) {
      for (const workCategory of WORK_CATEGORIES) {
        for (const residential of [true, false]) {
          for (const lineKind of LINE_KINDS) {
            const rule = rules.find(
              (r) =>
                r.customerType === customerType &&
                r.workCategory === workCategory &&
                r.residential === residential &&
                r.lineKind === lineKind
            )
            const code = rule!.vatCode
            assert.equal(
              code.natura ?? code.name,
              expectedSeed(customerType, workCategory, residential),
              `${customerType} ${workCategory} residential=${residential} ${lineKind}`
            )
          }
        }
      }
    }
  })

  test("a Job's defaults follow its Customer, Work Category and Site", async ({ assert }) => {
    const home = await createSite({ residential: true })
    const shop = await createSite({ residential: false })
    const person = await createCustomer({ type: 'private', name: null, firstName: 'Mario' })
    const company = await createCustomer()
    const cases = [
      [person, 'maintenance', home.id, null],
      [person, 'maintenance', shop.id, 22],
      [person, 'repair', home.id, 22],
      [company, 'repair', home.id, 'N6.7'],
      [company, 'sale', home.id, 22],
      // No Site: not residential
      [person, 'renovation', null, 22],
    ] as const
    for (const [customer, workCategory, siteId, expected] of cases) {
      const job = await createJob(customer, { workCategory, siteId })
      const defaults = await VatDefaults.forJob(job)
      const code = defaults.significant_good
      const label = expected === null ? '10.00' : expected === 22 ? '22.00' : expected
      assert.equal(code.natura ?? code.rate, label, `${customer.type} ${workCategory} ${siteId}`)
    }
  })

  test('the Admin changes a rule; new lines follow, existing lines stay', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')
    const office = await createUser('office')
    const job = await createJob(await createCustomer(), { workCategory: 'repair' })
    const draft = await Invoices.create(await createCustomer())
    await draft.merge({ jobId: job.id }).save()
    const rule = await VatRule.query()
      .where({
        customerType: 'company',
        workCategory: 'repair',
        residential: false,
        lineKind: 'labour',
      })
      .firstOrFail()
    const fivePercent = await VatCode.findByOrFail('name', '5%')

    const response = await client
      .put('/settings/vat-rules')
      .form({ 'rules[0][id]': String(rule.id), 'rules[0][vatCodeId]': String(fivePercent.id) })
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.vatRulesSaved'))
    await rule.refresh()
    assert.equal(rule.vatCodeId, fivePercent.id)

    // The Invoice page offers the new default for labour
    const page = await client.get(`/invoices/${draft.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ vatDefaults: { labour: fivePercent.id } })
  })

  test('an archived code can not be chosen for a rule', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const rule = await VatRule.firstOrFail()
    const before = rule.vatCodeId
    const old = await VatCode.findByOrFail('name', '4%')
    old.archivedAt = DateTime.now()
    await old.save()

    const response = await client
      .put('/settings/vat-rules')
      .form({ 'rules[0][id]': String(rule.id), 'rules[0][vatCodeId]': String(old.id) })
      .header('referer', '/settings/vat-rules')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    assert.properties(response.flashMessage('inputErrorsBag'), ['rules.0.vatCodeId'])
    await rule.refresh()
    assert.equal(rule.vatCodeId, before)
  })

  test('an Invoice without a Job has no rule defaults, only the standard rate', async ({
    client,
  }) => {
    const office = await createUser('office')
    const draft = await Invoices.create(await createCustomer())
    const standard = await VatDefaults.standard()

    const page = await client.get(`/invoices/${draft.id}/edit`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ vatDefaults: null, standardVatCodeId: standard.id })
  })

  test('only the Admin manages the rules', async ({ client, assert }) => {
    const rule = await VatRule.firstOrFail()
    const before = rule.vatCodeId
    const other = await VatCode.findByOrFail('name', '5%')
    for (const role of ['office', 'technician', 'superuser'] as const) {
      const user = await createUser(role)
      const page = await client.get('/settings/vat-rules').withInertia().loginAs(user)
      page.assertStatus(403)
      const update = await client
        .put('/settings/vat-rules')
        .form({ 'rules[0][id]': String(rule.id), 'rules[0][vatCodeId]': String(other.id) })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      update.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    await rule.refresh()
    assert.equal(rule.vatCodeId, before)
  })
})
