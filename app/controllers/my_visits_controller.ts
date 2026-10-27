import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { DateTime } from 'luxon'
import Visit from '#models/visit'
import { localDateTime } from '#services/dates'
import { storagePath } from '#services/storage'
import { visitNoteValidator, visitPhotoValidator, visitStatusValidator } from '#validators/field'
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
      // A cancelled Job's Visits no longer send anyone out
      .whereHas('job', (job) => job.whereNot('status', 'cancelled'))
      .preload('job', (job) => job.preload('customer').preload('site'))
      .orderBy('startsAt')

    return inertia.render('field/index', {
      visits: visits.map((visit) => ({
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        endsAt: localDateTime(visit.endsAt),
        status: visit.status,
        job: { number: visit.job.number, title: visit.job.title },
        customer: visit.job.customer.displayName,
        site: visit.job.site?.summary ?? null,
      })),
    })
  }

  async show({ params, inertia, bouncer }: HttpContext) {
    const visit = await this.load(params.id)
    await bouncer.authorize('viewVisit', visit)

    const { job } = visit
    return inertia.render('field/show', {
      visit: {
        id: visit.id,
        startsAt: localDateTime(visit.startsAt),
        endsAt: localDateTime(visit.endsAt),
        status: visit.status,
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
      notes: visit.fieldNotes.map((note) => ({
        id: note.id,
        body: note.body,
        author: note.author?.fullName ?? note.author?.email ?? null,
        createdAt: localDateTime(note.createdAt),
      })),
      photos: visit.photos.map((photo) => ({ id: photo.id })),
    })
  }

  async updateStatus({ params, request, response, session, bouncer, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await bouncer.authorize('viewVisit', visit)
    const { status } = await request.validateUsing(visitStatusValidator)

    visit.status = status
    await visit.save()

    session.flash('success', i18n.t('flash.visitStatusSaved'))
    response.redirect().toRoute('my_visits.show', { id: visit.id })
  }

  async addNote({ params, request, response, session, auth, bouncer, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await bouncer.authorize('viewVisit', visit)
    const { body } = await request.validateUsing(visitNoteValidator)

    await visit.related('fieldNotes').create({ body, userId: auth.user!.id })

    session.flash('success', i18n.t('flash.visitNoteAdded'))
    response.redirect().toRoute('my_visits.show', { id: visit.id })
  }

  async addPhoto({ params, request, response, session, auth, bouncer, i18n }: HttpContext) {
    const visit = await Visit.findOrFail(params.id)
    await bouncer.authorize('viewVisit', visit)
    const { photo } = await request.validateUsing(visitPhotoValidator)

    const extname = photo.extname!.toLowerCase()
    const directory = `visits/${visit.id}`
    const fileName = `${randomUUID()}.${extname}`
    await photo.move(storagePath(directory), { name: fileName })
    try {
      await visit.related('photos').create({
        userId: auth.user!.id,
        filePath: `${directory}/${fileName}`,
        mimeType: PHOTO_TYPES[extname],
        sizeBytes: photo.size,
      })
    } catch (error) {
      await unlink(storagePath(directory, fileName)).catch(() => {})
      throw error
    }

    session.flash('success', i18n.t('flash.visitPhotoAdded'))
    response.redirect().toRoute('my_visits.show', { id: visit.id })
  }

  private load(id: number) {
    return Visit.query()
      .where('id', id)
      .preload('technicians')
      .preload('fieldNotes', (notes) => notes.preload('author').orderBy('createdAt'))
      .preload('photos', (photos) => photos.orderBy('createdAt'))
      .preload('job', (job) =>
        job
          .preload('customer')
          .preload('site', (site) =>
            site.preload('installedEquipment', (equipment) =>
              equipment
                .orderBy(['equipment_type', 'id'])
                .preload('item', (item) =>
                  item.preload('documents', (docs) => docs.orderBy('title'))
                )
            )
          )
      )
      .firstOrFail()
  }
}
