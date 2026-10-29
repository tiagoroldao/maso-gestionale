import { test } from '@japa/runner'
import Customer from '#models/customer'
import { createUser } from '#tests/helpers/users'
import {
  createCustomer,
  defaultPaymentTerms,
  privateCustomerFields,
} from '#tests/helpers/customers'

test.group('Customers', () => {
  test('creates a private individual with SDI defaults', async ({ client, assert }) => {
    const office = await createUser('office')
    const terms = await defaultPaymentTerms()

    const response = await client
      .post('/customers')
      .form({
        ...privateCustomerFields({ taxCode: 'rssmra85t10a562s', province: 'mi' }),
        paymentTermsId: String(terms.id),
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    const customer = await Customer.firstOrFail()
    response.assertHeader('location', `/customers/${customer.id}`)
    assert.equal(customer.displayName, 'Mario Rossi')
    assert.equal(customer.taxCode, 'RSSMRA85T10A562S')
    assert.equal(customer.province, 'MI')
    assert.equal(customer.sdiCode, '0000000')
    assert.isNull(customer.name)
  })

  test('creates a company with SDI code and PEC', async ({ client, assert }) => {
    const office = await createUser('office')
    const terms = await defaultPaymentTerms()

    await client
      .post('/customers')
      .form({
        type: 'company',
        name: 'Edilizia Bianchi S.p.A.',
        vatNumber: '01114601006',
        sdiCode: 'm5uxcr1',
        pec: 'bianchi@pec.example.com',
        street: 'Corso Italia',
        postalCode: '10121',
        city: 'Torino',
        province: 'TO',
        paymentTermsId: String(terms.id),
      })
      .withCsrfToken()
      .loginAs(office)

    const customer = await Customer.firstOrFail()
    assert.equal(customer.displayName, 'Edilizia Bianchi S.p.A.')
    assert.equal(customer.sdiCode, 'M5UXCR1')
    assert.equal(customer.pec, 'bianchi@pec.example.com')
  })

  test('a PEC must be plain ASCII, as FatturaPA takes it', async ({ client, assert }) => {
    const office = await createUser('office')
    const terms = await defaultPaymentTerms()

    for (const pec of ['niccolò@pec.example.com', 'bianchi@pèc.example.com']) {
      const response = await client
        .post('/customers')
        .form({
          type: 'company',
          name: 'Edilizia Bianchi S.p.A.',
          vatNumber: '01114601006',
          sdiCode: '0000000',
          pec,
          street: 'Corso Italia',
          postalCode: '10121',
          city: 'Torino',
          province: 'TO',
          paymentTermsId: String(terms.id),
        })
        .header('referer', '/customers/create')
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      assert.properties(response.flashMessage('inputErrorsBag'), ['pec'], pec)
    }
    assert.isNull(await Customer.first())
  })

  test('creates a condominium with its numeric Codice Fiscale', async ({ client, assert }) => {
    const office = await createUser('office')
    const terms = await defaultPaymentTerms()

    await client
      .post('/customers')
      .form({
        type: 'condominium',
        name: 'Condominio Via Verdi 10',
        taxCode: '97123450153',
        street: 'Via Verdi',
        streetNumber: '10',
        postalCode: '20121',
        city: 'Milano',
        province: 'MI',
        paymentTermsId: String(terms.id),
      })
      .withCsrfToken()
      .loginAs(office)

    const customer = await Customer.firstOrFail()
    assert.equal(customer.type, 'condominium')
    assert.deepEqual(customer.toRecipient(), {
      name: 'Condominio Via Verdi 10',
      addressLines: ['Via Verdi, 10', '20121 Milano (MI)'],
      vatNumber: null,
      taxCode: '97123450153',
    })
  })

  test('creates an association with its numeric Codice Fiscale and no Partita IVA', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const terms = await defaultPaymentTerms()
    const fields = {
      type: 'organisation',
      name: 'Associazione Amici del Parco',
      street: 'Via Roma',
      postalCode: '20121',
      city: 'Milano',
      province: 'MI',
      paymentTermsId: String(terms.id),
    }

    const personal = await client
      .post('/customers')
      .form({ ...fields, taxCode: 'RSSMRA85T10A562S' })
      .header('referer', '/customers/create')
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(personal.flashMessage('inputErrorsBag'), ['taxCode'])

    await client
      .post('/customers')
      .form({ ...fields, taxCode: '97123450153' })
      .withCsrfToken()
      .loginAs(office)

    const customer = await Customer.firstOrFail()
    assert.equal(customer.type, 'organisation')
    assert.equal(customer.displayName, 'Associazione Amici del Parco')
    assert.isNull(customer.vatNumber)
  })

  test('requires the name and tax fields that fit the type', async ({ client, assert }) => {
    const office = await createUser('office')
    const terms = await defaultPaymentTerms()
    const address = { street: 'Via Roma', postalCode: '20121', city: 'Milano', province: 'MI' }
    const cases = [
      { form: { type: 'private' }, errors: ['firstName', 'lastName', 'taxCode'] },
      { form: { type: 'company' }, errors: ['name', 'vatNumber'] },
      { form: { type: 'condominium' }, errors: ['name', 'taxCode'] },
      {
        form: { type: 'private', firstName: 'A', lastName: 'B', taxCode: '12345678903' },
        errors: ['taxCode'],
      },
      {
        form: { type: 'condominium', name: 'Cond.', taxCode: 'RSSMRA85T10A562S' },
        errors: ['taxCode'],
      },
      {
        form: { type: 'company', name: 'X', vatNumber: '12345678901', sdiCode: 'ABC' },
        errors: ['vatNumber', 'sdiCode'],
      },
      {
        form: { type: 'private', firstName: '   ', lastName: ' ', taxCode: 'RSSMRA85T10A562S' },
        errors: ['firstName', 'lastName'],
      },
      {
        form: { type: 'company', name: 'x'.repeat(81), vatNumber: '12345678903' },
        errors: ['name'],
      },
    ]

    for (const { form, errors } of cases) {
      const response = await client
        .post('/customers')
        .form({ ...address, paymentTermsId: String(terms.id), ...form })
        .header('referer', '/customers/create')
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)

      const bag = response.flashMessage('inputErrorsBag') ?? {}
      assert.sameMembers(Object.keys(bag), errors, `errors for ${JSON.stringify(form)}`)
    }
    assert.lengthOf(await Customer.all(), 0)
  })

  test('editing to a private individual clears the company fields', async ({ client, assert }) => {
    const office = await createUser('office')
    const customer = await createCustomer()

    await client
      .put(`/customers/${customer.id}`)
      .form({ ...privateCustomerFields(), paymentTermsId: String(customer.paymentTermsId) })
      .withCsrfToken()
      .loginAs(office)

    await customer.refresh()
    assert.equal(customer.type, 'private')
    assert.isNull(customer.name)
    assert.isNull(customer.vatNumber)
    assert.equal(customer.displayName, 'Mario Rossi')
  })

  test('searches by name, Codice Fiscale and Partita IVA', async ({ client, assert }) => {
    const admin = await createUser('admin')
    await createCustomer({ name: 'Edilizia Bianchi', vatNumber: '01114601006' })
    await createCustomer({
      type: 'private',
      name: null,
      vatNumber: null,
      firstName: 'Mario',
      lastName: 'Rossi',
      taxCode: 'RSSMRA85T10A562S',
    })

    const search = async (q: string) => {
      const response = await client.get('/customers').qs({ q }).withInertia().loginAs(admin)
      return (response.inertiaProps.customers as { displayName: string }[]).map(
        (customer) => customer.displayName
      )
    }

    assert.deepEqual(await search('bianchi'), ['Edilizia Bianchi'])
    assert.deepEqual(await search('mario rossi'), ['Mario Rossi'])
    assert.deepEqual(await search('rossi mario'), ['Mario Rossi'])
    assert.deepEqual(await search('rssmra85'), ['Mario Rossi'])
    assert.deepEqual(await search('01114601006'), ['Edilizia Bianchi'])
    assert.deepEqual(await search('IT01114601006'), ['Edilizia Bianchi'])
    assert.deepEqual(await search('RSSMRA85 T10A562S'), ['Mario Rossi'])
    assert.deepEqual(await search('%'), [])
    assert.deepEqual(await search('_'), [])
  })

  test('paginates the list', async ({ client, assert }) => {
    const admin = await createUser('admin')
    for (let i = 0; i < 26; i++) {
      await createCustomer({ name: `Customer ${String(i).padStart(2, '0')}` })
    }

    const second = await client.get('/customers').qs({ page: 2 }).withInertia().loginAs(admin)

    assert.lengthOf(second.inertiaProps.customers as unknown[], 1)
    second.assertInertiaPropsContains({ pagination: { currentPage: 2, lastPage: 2, total: 26 } })
  })

  test('renders the edit page with the saved values', async ({ client }) => {
    const office = await createUser('office')
    const customer = await createCustomer({ name: 'Edilizia Bianchi' })

    const response = await client
      .get(`/customers/${customer.id}/edit`)
      .withInertia()
      .loginAs(office)

    response.assertInertiaComponent('customers/form')
    response.assertInertiaPropsContains({ customer: { id: customer.id, name: 'Edilizia Bianchi' } })
  })

  test('Technicians and the Superuser can not list or edit Customers', async ({ client }) => {
    const customer = await createCustomer()

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const url of ['/customers', `/customers/${customer.id}/edit`]) {
        const response = await client.get(url).withInertia().loginAs(user)
        response.assertStatus(403)
      }
    }
  })
})
