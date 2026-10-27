import Site from '#models/site'
import InstalledEquipment from '#models/installed_equipment'
import { installedEquipmentValidator } from '#validators/installed_equipment'
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
}
