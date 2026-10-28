import InstalledEquipment from '#models/installed_equipment'
import Job from '#models/job'
import Site from '#models/site'
import TemplateData from '#services/template_data'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * What a Document Template's entity fields can be filled with, as JSON
 * for the filling form. Sites come from the Site search, which lists the
 * Customer's own first.
 */
export default class TemplateChoicesController {
  /**
   * The Installed Equipment still at a Site.
   */
  async equipment({ params }: HttpContext) {
    const site = await Site.findOrFail(params.id)
    const equipment = await InstalledEquipment.query()
      .where('siteId', site.id)
      .whereNull('removedOn')
      .orderBy(['equipmentType', 'id'])

    return {
      equipment: equipment.map((unit) => ({ id: unit.id, description: unit.description })),
    }
  }

  /**
   * A Customer's Jobs, newest first.
   */
  async jobs({ params }: HttpContext) {
    const jobs = await Job.query()
      .where('customerId', params.id)
      .orderBy([
        { column: 'year', order: 'desc' },
        { column: 'sequence', order: 'desc' },
      ])

    return { jobs: jobs.map((job) => ({ id: job.id, number: job.number, title: job.title })) }
  }

  /**
   * "Load from Job": the Items used on it, with the quantities summed.
   */
  async itemsUsed({ params }: HttpContext) {
    const job = await Job.findOrFail(params.id)
    return { items: await TemplateData.itemsUsed(job) }
  }
}
