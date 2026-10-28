import vine from '@vinejs/vine'
import { VISIT_STATUSES } from '#models/visit'
import { quantityRule } from '#validators/rules/quantity'

export const visitStatusValidator = vine.create({
  status: vine.enum(VISIT_STATUSES),
})

export const visitNoteValidator = vine.create({
  body: vine.string().trim().minLength(1).maxLength(5000),
})

/**
 * Phone photos: browsers convert HEIC to JPEG when uploading from the
 * camera, so common web image types are enough.
 */
export const visitPhotoValidator = vine.create({
  photo: vine.file({ size: '15mb', extnames: ['jpg', 'jpeg', 'png', 'webp'] }),
})

export const visitHoursValidator = vine.create({
  technicianId: vine.number(),
  labourRateId: vine.number().exists({
    table: 'labour_rates',
    column: 'id',
    filter: (db) => {
      db.whereNull('archived_at')
    },
  }),
  hours: vine.string().use(quantityRule({ allowNegative: false, max: '24' })),
})

export const visitItemValidator = vine.create({
  itemId: vine.number().exists({
    table: 'items',
    column: 'id',
    filter: (db) => {
      db.whereNull('archived_at')
    },
  }),
  quantity: vine.string().use(quantityRule({ allowNegative: false, max: '99999' })),
  installed: vine.boolean().optional(),
  serialNumber: vine.string().trim().maxLength(100).optional(),
  // Installing onto equipment already registered at the Site, or new
  // equipment described by type, make and model
  equipmentId: vine.number().optional(),
  equipmentType: vine.string().trim().maxLength(100).optional(),
  make: vine.string().trim().maxLength(100).optional(),
  model: vine.string().trim().maxLength(100).optional(),
})

/**
 * Which of the Site's equipment the Visit serviced.
 */
export const servicedEquipmentValidator = vine.create({
  equipmentIds: vine.array(vine.number()).distinct().optional(),
})
