import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Visit from '#models/visit'
import VisitPhoto from '#models/visit_photo'
import VisitNote from '#models/visit_note'
import Charge from '#models/charge'
import IssuedDocument from '#models/issued_document'
import LabourRate from '#models/labour_rate'
import FieldWork, { FieldWorkRefusedError } from '#services/field_work'
import Installations from '#services/installations'
import { isOpenVisit } from '#shared/visits'
import { localDateTime } from '#services/dates'
import { flashWithStockWarning } from '#stock/stock_warning'
import { ACTIVE_JOB_STATUSES } from '#shared/jobs'
import { storagePath } from '#services/storage'
import {
  visitHoursValidator,
  servicedEquipmentValidator,
  visitItemValidator,
  visitNoteValidator,
  visitPhotoValidator,
  visitStatusValidator,
  notDoneIn,
} from '#validators/field'
import type { HttpContext } from '@adonisjs/core/http'

const UPCOMING_DAYS = 14

const PHOTO_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/**
 * A Technician's own Visits, on their phone. Nothing here carries prices,
 * costs or totals (PRD); the props are built field by field.
 */
export default class MyVisitsController {
  async index({ auth, inertia }: HttpContext) {
    const technician = auth.getUserOrFail()
    const from = DateTime.now().startOf('day')

    const visits = await Visit.query()
      .whereHas('technicians', (users) => users.where('users.id', technician.id))
      .where('endsAt', '>', from.toJSDate())
      .where('startsAt', '<', from.plus({ days: UPCOMING_DAYS }).toJSDate())
      // A closed or cancelled Job's Visits no longer send anyone out, nor
      // does a cancelled Visit (#157)
      .whereHas('job', (job) => job.whereIn('status', [...ACTIVE_JOB_STATUSES]))
      .whereNot('status', 'cancelled')
      .preload('job', (job) => job.preload('customer').preload('site'))
      .orderBy('startsAt')

    return inertia.render('field/index', {
      visits: visits.map((visit) => ({
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        endsAt: localDateTime(visit.endsAt),
        status: visit.status,
        survey: visit.survey,
        job: { number: visit.job.number, title: visit.job.title },
        customer: visit.job.customer.displayName,
        site: visit.job.site?.summary ?? null,
      })),
    })
  }

  async show({ params, inertia, bouncer, auth }: HttpContext) {
    const visit = await this.load(params.id)
    await bouncer.authorize('viewVisit', visit)

    const { job } = visit
    const rates = await LabourRate.query().whereNull('archived_at').orderBy('name')
    const serviced = await db
      .from('visit_serviced_equipment')
      .where('visit_id', visit.id)
      .select('installed_equipment_id')
    // The Site's Issued Documents still in force (replaced ones are not)
    const issued = job.site
      ? await IssuedDocument.query()
          .where('siteId', job.site.id)
          .whereNull('replacedById')
          .preload('version')
          .orderBy([
            { column: 'issuedOn', order: 'desc' },
            { column: 'id', order: 'desc' },
          ])
      : []
    return inertia.render('field/show', {
      visit: {
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        endsAt: localDateTime(visit.endsAt),
        status: visit.status,
        survey: visit.survey,
        officeNotes: visit.notes,
        technicians: visit.technicians.map((user) => user.fullName ?? user.email),
      },
      job: { number: job.number, title: job.title, description: job.description },
      customer: {
        name: job.customer.displayName,
        phone: job.customer.phone,
      },
      site: job.site
        ? {
            summary: job.site.summary,
            accessNotes: job.site.accessNotes,
            equipment: job.site.installedEquipment.map((equipment) => ({
              id: equipment.id,
              description: equipment.description,
              serialNumber: equipment.serialNumber,
              nextDueOn: equipment.nextDueOn?.toISODate() ?? null,
              documents: (equipment.item?.documents ?? []).map((document) => ({
                id: document.id,
                title: document.title,
              })),
            })),
          }
        : null,
      // Closed or cancelled, or frozen because the Job was closed or
      // cancelled: read-only
      done: !isOpenVisit(visit.status) || !job.isActive,
      servicedIds: serviced.map((row) => row.installed_equipment_id as number),
      currentUserId: auth.getUserOrFail().id,
      team: visit.technicians.map((user) => ({ id: user.id, name: user.fullName ?? user.email })),
      // Rate names only: Technicians never see prices
      labourRates: rates.map((rate) => ({ id: rate.id, name: rate.name })),
      hours: visit.hours.map((hour) => ({
        id: hour.id,
        technician: hour.worker ?? '',
        labourRate: hour.labourRate.name,
        hours: hour.quantity,
        // Unticked when the Visit closed (ADR 0016)
        notDone: hour.workState === 'not_done',
      })),
      items: visit.items.map((line) => ({
        id: line.id,
        code: line.item.code,
        description: line.item.description,
        unit: line.item.unit,
        quantity: line.quantity,
        installed: line.installed,
        notDone: line.workState === 'not_done',
      })),
      notes: visit.fieldNotes.map((note) => ({
        id: note.id,
        body: note.body,
        author: note.author?.fullName ?? note.author?.email ?? null,
        createdAt: localDateTime(note.createdAt),
      })),
      photos: visit.photos.map((photo) => ({ id: photo.id })),
      issuedDocuments: issued.map((document) => ({
        id: document.id,
        title: document.version.name,
        number: document.number,
        issuedOn: document.issuedOn.toISODate()!,
      })),
    })
  }

  async updateStatus({ params, request, response, session, auth, bouncer, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await bouncer.authorize('viewVisit', visit)
    const { status, ...review } = await request.validateUsing(visitStatusValidator)

    return this.refusable(visit, { response, session, i18n }, async () => {
      const warnings = await FieldWork.setStatus(
        visit,
        status,
        auth.getUserOrFail(),
        notDoneIn(review)
      )
      // Equipment changed since it was recorded: told, as Office is (#168)
      await flashWithStockWarning(
        { session, i18n },
        [],
        i18n.t('flash.visitStatusSaved'),
        undefined,
        Installations.messages(i18n, warnings)
      )
    })
  }

  async addNote({ params, request, response, session, auth, bouncer, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await bouncer.authorize('viewVisit', visit)
    const { body } = await request.validateUsing(visitNoteValidator)

    return this.refusable(visit, { response, session, i18n }, async () => {
      await FieldWork.whileJobActive(visit, (trx) =>
        VisitNote.create({ visitId: visit.id, body, userId: auth.user!.id }, { client: trx })
      )
      session.flash('success', i18n.t('flash.visitNoteAdded'))
    })
  }

  async addPhoto({ params, request, response, session, auth, bouncer, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await bouncer.authorize('viewVisit', visit)
    const { photo } = await request.validateUsing(visitPhotoValidator)

    const extname = photo.extname!.toLowerCase()
    const directory = `visits/${visit.id}`
    const fileName = `${randomUUID()}.${extname}`
    await photo.move(storagePath(directory), { name: fileName })
    return this.refusable(visit, { response, session, i18n }, async () => {
      try {
        await FieldWork.whileJobActive(visit, (trx) =>
          VisitPhoto.create(
            {
              visitId: visit.id,
              userId: auth.user!.id,
              filePath: `${directory}/${fileName}`,
              mimeType: PHOTO_TYPES[extname],
              sizeBytes: photo.size,
            },
            { client: trx }
          )
        )
      } catch (error) {
        // Refused or failed: the stored file has no record, so remove it
        await unlink(storagePath(directory, fileName)).catch(() => {})
        throw error
      }
      session.flash('success', i18n.t('flash.visitPhotoAdded'))
    })
  }

  async addHours({ params, request, response, session, auth, bouncer, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await bouncer.authorize('viewVisit', visit)
    const data = await request.validateUsing(visitHoursValidator)

    return this.refusable(visit, { response, session, i18n }, async () => {
      await FieldWork.recordHours(visit, data, auth.getUserOrFail())
      session.flash('success', i18n.t('flash.visitHoursAdded'))
    })
  }

  /**
   * Removes hours or an Item recorded by mistake on the Visit.
   */
  async removeCharge({ params, response, session, bouncer, i18n }: HttpContext) {
    const charge = await Charge.query().where('id', params.id).whereNotNull('visitId').firstOrFail()
    const visit = await Visit.findOrFail(charge.visitId)
    await bouncer.authorize('viewVisit', visit)

    return this.refusable(visit, { response, session, i18n }, () => FieldWork.removeCharge(charge))
  }

  /**
   * Which of the Site's equipment the Visit serviced.
   */
  async setServiced({ params, request, response, session, bouncer, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await bouncer.authorize('viewVisit', visit)
    const { equipmentIds = [] } = await request.validateUsing(servicedEquipmentValidator)

    return this.refusable(visit, { response, session, i18n }, async () => {
      await FieldWork.setServiced(visit, equipmentIds)
      session.flash('success', i18n.t('flash.servicedSaved'))
    })
  }

  async addItem({ params, request, response, session, auth, bouncer, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await bouncer.authorize('viewVisit', visit)
    const data = await request.validateUsing(visitItemValidator)

    return this.refusable(visit, { response, session, i18n }, async () => {
      await FieldWork.recordItem(visit, data, auth.getUserOrFail())
      // Planned until the Visit closes, so committed: warn when short
      await flashWithStockWarning({ session, i18n }, [data.itemId], i18n.t('flash.visitItemAdded'))
    })
  }

  /**
   * Runs `work`, turning a refusal (done Visit, cancelled Job, Technician
   * not on it, no Site to install at) into a message on the Visit page.
   */
  private async refusable(
    visit: Visit,
    { response, session, i18n }: Pick<HttpContext, 'response' | 'session' | 'i18n'>,
    work: () => Promise<unknown>
  ) {
    try {
      await work()
    } catch (error) {
      if (!(error instanceof FieldWorkRefusedError)) throw error
      session.flash('error', i18n.t(`flash.fieldWorkRefused.${error.reason}`))
    }
    return response.redirect().toRoute('my_visits.show', { id: visit.id })
  }

  private load(id: number) {
    return Visit.query()
      .where('id', id)
      .preload('technicians')
      .preload('fieldNotes', (notes) => notes.preload('author').orderBy('createdAt'))
      .preload('photos', (photos) => photos.orderBy('createdAt'))
      .preload('hours', (hours) =>
        hours
          .preload('technician')
          .preload('labourRate')
          .preload('events', (events) => events.orderBy('id'))
          .orderBy('createdAt')
      )
      .preload('items', (items) =>
        items
          .preload('item')
          .preload('events', (events) => events.orderBy('id'))
          .orderBy('createdAt')
      )
      .preload('job', (job) =>
        job.preload('customer').preload('site', (site) =>
          site.preload('installedEquipment', (equipment) =>
            equipment
              // Removed equipment isn't at the Site any more
              .whereNull('removed_on')
              .orderBy(['equipment_type', 'id'])
              .preload('item', (item) => item.preload('documents', (docs) => docs.orderBy('title')))
          )
        )
      )
      .firstOrFail()
  }
}
