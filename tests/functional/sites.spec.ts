import { test } from '@japa/runner'
import Site from '#models/site'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'

const siteFields = {
  label: 'Casa al mare',
  street: 'Lungomare Colombo',
  streetNumber: '12',
  unit: 'scala B, int. 4',
  postalCode: '16121',
  city: 'Genova',
  province: 'ge',
  accessNotes: 'Keys with the concierge',
}

test.group('Sites', () => {
  test('creates a Site on its own', async ({ client, assert }) => {
    const office = await createUser('office')

    const response = await client
      .post('/sites')
      .form(siteFields)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    const site = await Site.firstOrFail()
    response.assertHeader('location', `/sites/${site.id}`)
    assert.equal(site.province, 'GE')
    assert.equal(
      site.summary,
      'Casa al mare — Lungomare Colombo 12, scala B, int. 4, 16121 Genova (GE)'
    )
  })

  test('creating from a Customer links the new Site to them', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()

    const response = await client
      .post('/sites')
      .form({ ...siteFields, customerId: String(customer.id) })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertHeader('location', `/customers/${customer.id}`)
    await customer.load('sites')
    assert.lengthOf(customer.sites, 1)
  })

  test('edits a Site', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()

    await client
      .put(`/sites/${site.id}`)
      .form({ ...siteFields, label: '' })
      .withCsrfToken()
      .loginAs(office)

    await site.refresh()
    assert.isNull(site.label)
    assert.equal(site.city, 'Genova')
  })

  test('links and unlinks an existing Site, once', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const site = await createSite()

    for (let i = 0; i < 2; i++) {
      await client
        .post(`/customers/${customer.id}/sites`)
        .form({ siteId: String(site.id) })
        .withCsrfToken()
        .loginAs(office)
    }
    await customer.load('sites')
    assert.lengthOf(customer.sites, 1)

    await client
      .delete(`/customers/${customer.id}/sites/${site.id}`)
      .withCsrfToken()
      .loginAs(office)
    await customer.load('sites')
    assert.lengthOf(customer.sites, 0)
    assert.isNotNull(await Site.find(site.id), 'unlinking keeps the Site')
  })

  test('a Site can belong to several Customers', async ({ client, assert }) => {
    const office = await createUser('office')
    const site = await createSite()
    const owner = await createCustomer({ name: 'Owner' })
    const administrator = await createCustomer({ name: 'Administrator' })

    for (const customer of [owner, administrator]) {
      await client
        .post(`/customers/${customer.id}/sites`)
        .form({ siteId: String(site.id) })
        .withCsrfToken()
        .loginAs(office)
    }

    await site.load('customers')
    assert.sameMembers(
      site.customers.map((customer) => customer.name),
      ['Owner', 'Administrator']
    )
  })

  test("the Customer's page lists their Sites", async ({ client }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const site = await createSite({ label: 'Negozio' })
    await customer.related('sites').attach([site.id])

    const response = await client.get(`/customers/${customer.id}`).withInertia().loginAs(office)

    response.assertInertiaComponent('customers/show')
    response.assertInertiaPropsContains({ sites: [{ id: site.id, summary: site.summary }] })
  })

  test('searches Sites by label and address', async ({ client, assert }) => {
    const office = await createUser('office')
    await createSite({ label: 'Negozio', street: 'Via Dante', city: 'Bergamo', province: 'BG' })
    await createSite({ street: 'Corso Buenos Aires', city: 'Milano' })

    const search = async (q: string) => {
      const response = await client.get('/sites').qs({ q }).withInertia().loginAs(office)
      return (response.inertiaProps.sites as { summary: string }[]).map((site) => site.summary)
    }

    assert.lengthOf(await search('negozio'), 1)
    assert.lengthOf(await search('buenos'), 1)
    assert.lengthOf(await search('bergamo'), 1)
    assert.lengthOf(await search('nowhere'), 0)
  })

  test('only Admin and Office manage Sites', async ({ client, assert }) => {
    const customer = await createCustomer()
    const site = await createSite()

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const url of ['/sites', '/sites/search', `/sites/${site.id}/edit`]) {
        const response = await client.get(url).withInertia().loginAs(user)
        response.assertStatus(403)
      }

      const refused = [
        client.post('/sites').form(siteFields),
        client.post(`/customers/${customer.id}/sites`).form({ siteId: String(site.id) }),
      ]
      for (const request of refused) {
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', 'Access denied')
      }
    }

    assert.lengthOf(await Site.all(), 1)
    await customer.load('sites')
    assert.lengthOf(customer.sites, 0)
  })

  test('non-numeric ids are not found', async ({ client }) => {
    const office = await createUser('office')
    const customer = await createCustomer()

    const response = await client
      .delete(`/customers/${customer.id}/sites/abc`)
      .withCsrfToken()
      .loginAs(office)

    response.assertStatus(404)
  })
})

test.group('Site picker', () => {
  test("lists the Customer's Sites first, then other matches", async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    // The linked Site sorts after the other one by address, so ordering by address alone fails
    const linked = await createSite({ street: 'Via Verdi', city: 'Torino', province: 'TO' })
    const other = await createSite({ street: 'Via Verdi', city: 'Milano' })
    await createSite({ street: 'Via Rossini', city: 'Milano' })
    await customer.related('sites').attach([linked.id])

    const response = await client
      .get('/sites/search')
      .qs({ customerId: customer.id, q: 'verdi' })
      .loginAs(office)

    assert.deepEqual(
      response.body().sites.map((site: { id: number; linked: boolean }) => [site.id, site.linked]),
      [
        [linked.id, true],
        [other.id, false],
      ]
    )
  })

  test("the Customer's many linked Sites don't crowd out other matches", async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    for (let i = 0; i < 25; i++) {
      const site = await createSite({ street: `Via Milano`, streetNumber: String(i + 1) })
      await customer.related('sites').attach([site.id])
    }
    const unlinked = await createSite({ street: 'Via Milano', streetNumber: '99', city: 'Monza' })

    const response = await client
      .get('/sites/search')
      .qs({ customerId: customer.id, q: 'milano' })
      .loginAs(office)

    const sites = response.body().sites as { id: number; linked: boolean }[]
    assert.lengthOf(
      sites.filter((site) => site.linked),
      25
    )
    assert.deepInclude(sites, { id: unlinked.id, summary: unlinked.summary, linked: false })
  })

  test("without a search term, shows only the Customer's Sites", async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const linked = await createSite()
    await createSite({ street: 'Via Altrove' })
    await customer.related('sites').attach([linked.id])

    const response = await client
      .get('/sites/search')
      .qs({ customerId: customer.id })
      .loginAs(office)

    assert.deepEqual(
      response.body().sites.map((site: { id: number }) => site.id),
      [linked.id]
    )
  })
})
