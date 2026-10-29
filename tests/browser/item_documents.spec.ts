import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import ItemDocument from '#models/item_document'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { createItem } from '#tests/helpers/items'
import { createSite } from '#tests/helpers/sites'
import { it } from '#tests/helpers/i18n'

test.group('Item Documents in the browser', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office uploads a manual, then links the Item to a boiler', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const item = await createItem({
      code: 'CALD-25',
      description: 'Caldaia 25 kW',
      maintenanceIntervalMonths: 12,
    })
    const site = await createSite()

    const edit = await visit(`/items/${item.id}/edit`)
    await edit.getByLabel(it('ui.items.documentTitle')).fill('Manuale di installazione')
    await edit
      .getByLabel(it('ui.items.documentFile'))
      .setInputFiles(app.makePath('tests/fixtures/manual.pdf'))
    await edit.getByRole('button', { name: it('ui.items.upload') }).click()
    await edit.getByRole('link', { name: 'Manuale di installazione' }).waitFor()
    assert.lengthOf(await ItemDocument.all(), 1)

    // Deleting asks first: dismissed, the document stays
    const messages: string[] = []
    edit.once('dialog', (dialog) => {
      messages.push(dialog.message())
      return dialog.dismiss()
    })
    await edit
      .getByRole('row', { name: /Manuale di installazione/ })
      .getByRole('button', { name: it('ui.common.delete') })
      .click()
    assert.deepEqual(messages, [it('ui.items.deleteDocumentConfirm')])
    assert.lengthOf(await ItemDocument.all(), 1)

    const form = await visit(`/sites/${site.id}/equipment/create`)
    await form.getByLabel(it('ui.equipment.type')).fill('Caldaia')
    await form.getByLabel(it('ui.equipment.serialNumber')).fill('SN-123')
    await form.getByLabel(it('ui.equipment.linkItem')).fill('cald')
    await form.getByRole('option', { name: /CALD-25/ }).click()

    assert.equal(await form.getByLabel(it('ui.equipment.interval')).inputValue(), '12')
    assert.equal(await form.getByLabel(it('ui.equipment.serialNumber')).inputValue(), 'SN-123')
    assert.equal(await form.getByLabel(it('ui.equipment.type')).inputValue(), 'Caldaia')
    await form.getByRole('button', { name: it('ui.equipment.save') }).click()
    await form.waitForURL(`**/sites/${site.id}`)
    await form.getByText('CALD-25').waitFor()
  })
})
