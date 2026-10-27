import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import VatCode from '#models/vat_code'
import { createUser } from '#tests/helpers/users'
import { createItem, vatCode } from '#tests/helpers/items'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

test.group('VAT Codes', () => {
  test('a fresh install has the seeded codes for review', async ({ client }) => {
    const admin = await createUser('admin')

    const response = await client.get('/settings/vat-codes').withInertia().loginAs(admin)

    response.assertInertiaPropsContains({
      vatCodes: [
        { name: '22%', rate: '22.00', natura: null },
        { name: '10%', rate: '10.00', natura: null },
        { name: '5%', rate: '5.00', natura: null },
        { name: '4%', rate: '4.00', natura: null },
        { name: 'Esente art. 10', rate: '0.00', natura: 'N4' },
        { name: 'Inversione contabile – impianti su edifici', rate: '0.00', natura: 'N6.7' },
        { name: 'Inversione contabile – subappalto edile', rate: '0.00', natura: 'N6.3' },
        { name: 'Non soggetta', rate: '0.00', natura: 'N2.2' },
      ],
    })
  })

  test('the Admin adds and edits a code', async ({ client, assert }) => {
    const admin = await createUser('admin')

    await client
      .post('/settings/vat-codes')
      .form({ name: 'Fuori campo', rate: '0', natura: 'N2.1', legalNote: 'Art. 7-ter' })
      .withCsrfToken()
      .loginAs(admin)
    const code = await VatCode.findByOrFail('name', 'Fuori campo')
    assert.equal(code.natura, 'N2.1')
    assert.equal(code.legalNote, 'Art. 7-ter')

    await client
      .put(`/settings/vat-codes/${code.id}`)
      .form({ name: 'Fuori campo IVA', rate: '0,00', natura: 'N2.2' })
      .withCsrfToken()
      .loginAs(admin)
    await code.refresh()
    assert.equal(code.name, 'Fuori campo IVA')
    assert.equal(code.natura, 'N2.2')
    assert.isNull(code.legalNote)
  })

  test('a Natura code goes with 0%, and only with 0%', async ({ client, assert }) => {
    const admin = await createUser('admin')

    for (const [form, field] of [
      [{ name: 'Senza natura', rate: '0' }, 'natura'],
      [{ name: 'Natura con aliquota', rate: '22', natura: 'N4' }, 'natura'],
      [{ name: '22%', rate: '22' }, 'name'],
      [{ name: 'Troppo', rate: '100' }, 'rate'],
      [{ name: 'Illeggibile', rate: 'abc', natura: 'N4' }, 'rate'],
    ] as const) {
      const response = await client
        .post('/settings/vat-codes')
        .form(form)
        .header('referer', '/settings/vat-codes')
        .withCsrfToken()
        .loginAs(admin)
        .redirects(0)
      const errors = response.flashMessage('inputErrorsBag') as Record<string, unknown>
      assert.deepEqual(Object.keys(errors), [field], form.name)
    }
    assert.lengthOf(await VatCode.all(), 8)
  })

  test('archived codes leave the list and pickers, but Items keep theirs', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')
    const reduced = await vatCode('5%')
    const item = await createItem({ vatCodeId: reduced.id })

    await client.post(`/settings/vat-codes/${reduced.id}/archive`).withCsrfToken().loginAs(admin)

    const list = await client.get('/settings/vat-codes').withInertia().loginAs(admin)
    const names = (list.inertiaProps.vatCodes as { name: string }[]).map((code) => code.name)
    assert.notInclude(names, '5%')

    const otherItem = await client.get('/items/create').withInertia().loginAs(admin)
    const options = (otherItem.inertiaProps.vatCodes as { id: number }[]).map((code) => code.id)
    assert.notInclude(options, reduced.id)
    const ownItem = await client.get(`/items/${item.id}/edit`).withInertia().loginAs(admin)
    const ownOptions = (ownItem.inertiaProps.vatCodes as { id: number }[]).map((code) => code.id)
    assert.include(ownOptions, reduced.id)

    // A new Item can't pick it
    const refused = await client
      .post('/items')
      .form({
        code: 'NEW',
        description: 'Nuovo',
        unit: 'pz',
        purchasePrice: '1',
        resalePrice: '2',
        vatCodeId: String(reduced.id),
      })
      .header('referer', '/items/create')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    assert.properties(refused.flashMessage('inputErrorsBag'), ['vatCodeId'])
  })

  test('an Item keeps its archived code on edit, but can not switch to another', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')
    const five = await vatCode('5%')
    const four = await vatCode('4%')
    const item = await createItem({ vatCodeId: five.id, significantGood: true })
    for (const code of [five, four]) {
      code.archivedAt = DateTime.now()
      await code.save()
    }
    const fields = {
      code: item.code,
      description: 'Caldaia',
      unit: 'pz',
      purchasePrice: '1',
      resalePrice: '2',
    }

    await client
      .put(`/items/${item.id}`)
      .form({ ...fields, vatCodeId: String(five.id) })
      .withCsrfToken()
      .loginAs(admin)
    await item.refresh()
    assert.equal(item.description, 'Caldaia')
    assert.equal(item.vatCodeId, five.id)
    // Unticked
    assert.isFalse(item.significantGood)

    const refused = await client
      .put(`/items/${item.id}`)
      .form({ ...fields, vatCodeId: String(four.id) })
      .header('referer', `/items/${item.id}/edit`)
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    assert.properties(refused.flashMessage('inputErrorsBag'), ['vatCodeId'])
  })

  test('only the Admin manages VAT Codes', async ({ client, assert }) => {
    const code = await vatCode()
    for (const role of ['office', 'technician'] as const) {
      const user = await createUser(role)
      const response = await client.get('/settings/vat-codes').withInertia().loginAs(user)
      response.assertStatus(403)
      for (const request of [
        client.post('/settings/vat-codes').form({ name: 'X', rate: '1' }),
        client.put(`/settings/vat-codes/${code.id}`).form({ name: 'X', rate: '1' }),
        client.post(`/settings/vat-codes/${code.id}/archive`),
      ]) {
        const denied = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    await code.refresh()
    assert.equal(code.name, '22%')
    assert.isNull(code.archivedAt)
  })
})
