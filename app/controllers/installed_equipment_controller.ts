import Site from '#models/site'
import InstalledEquipment from '#models/installed_equipment'
import Archiving, { InvalidReplacementError } from '#services/archiving'
import {
  installedEquipmentValidator,
  removeEquipmentValidator,
} from '#validators/installed_equipment'
import type { HttpContext } from '@adonisjs/core/http'
import type { Infer } from '@vinejs/vine/types'

function toAttributes(data: Infer<typeof installedEquipmentValidator>) {
  return {
    equipmentType: data.equipmentType,
    make: data.make ?? null,
    model: data.model ?? null,
    serialNumber: data.serialNumber ?? null,
    installedOn: data.installedOn ?? null,
    maintenanceIntervalMonths: data.maintenanceIntervalMonths ?? null,
    lastServicedOn: data.lastServicedOn ?? null,
    notes: data.notes ?? null,
    itemId: data.itemId ?? null,
  }
}

function siteProps(site: Site) {
  return { id: site.id, summary: site.summary }
}

export default class InstalledEquipmentController {
  async create({ params, inertia }: HttpContext) {
    const site = await Site.findOrFail(params.siteId)
    return inertia.render('installed_equipment/form', { site: siteProps(site), equipment: null })
  }

  async store({ params, request, response, session, i18n }: HttpContext) {
    const site = await Site.findOrFail(params.siteId)
    const data = await request.validateUsing(installedEquipmentValidator)

    await site.related('installedEquipment').create(toAttributes(data))

    session.flash('success', i18n.t('flash.equipmentAdded'))
    response.redirect().toRoute('sites.show', { id: site.id })
  }

  async edit({ params, inertia }: HttpContext) {
    const equipment = await InstalledEquipment.query()
      .where('id', params.id)
      .preload('site')
      .preload('item', (item) => item.preload('documents', (docs) => docs.orderBy('title')))
      .firstOrFail()

    return inertia.render('installed_equipment/form', {
      site: siteProps(equipment.site),
      equipment: {
        id: equipment.id,
        equipmentType: equipment.equipmentType,
        make: equipment.make,
        model: equipment.model,
        serialNumber: equipment.serialNumber,
        installedOn: equipment.installedOn?.toISODate() ?? null,
        maintenanceIntervalMonths: equipment.maintenanceIntervalMonths,
        lastServicedOn: equipment.lastServicedOn?.toISODate() ?? null,
        notes: equipment.notes,
        item: equipment.item
          ? {
              id: equipment.item.id,
              code: equipment.item.code,
              description: equipment.item.description,
              maintenanceIntervalMonths: equipment.item.maintenanceIntervalMonths,
              documents: equipment.item.documents.map((document) => ({
                id: document.id,
                title: document.title,
              })),
            }
          : null,
      },
    })
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const equipment = await InstalledEquipment.findOrFail(params.id)
    const data = await request.validateUsing(installedEquipmentValidator)

    await equipment.merge(toAttributes(data)).save()

    session.flash('success', i18n.t('flash.equipmentSaved'))
    response.redirect().toRoute('sites.show', { id: equipment.siteId })
  }

  /**
   * Records that the equipment was taken out, optionally replaced by other
   * equipment at the Site; it leaves the Site's current list.
   */
  async remove({ params, request, response, session, i18n }: HttpContext) {
    const equipment = await InstalledEquipment.findOrFail(params.id)
    const data = await request.validateUsing(removeEquipmentValidator)
    try {
      await Archiving.removeEquipment(equipment, {
        removedOn: data.removedOn,
        replacedById: data.replacedById ?? null,
      })
      session.flash('success', i18n.t('flash.equipmentRemoved'))
    } catch (error) {
      if (!(error instanceof InvalidReplacementError)) throw error
      session.flash('error', i18n.t('flash.invalidReplacement'))
    }
    response.redirect().toRoute('sites.show', { id: equipment.siteId })
  }
}
