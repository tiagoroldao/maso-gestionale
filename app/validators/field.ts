import vine from '@vinejs/vine'
import { VISIT_STATUSES } from '#models/visit'
import { quantityRule } from '#validators/rules/quantity'

/**
 * The review of a Visit's Charges when it closes (ADR 0016): `reviewed`
 * lists the Charges shown, `done` those left ticked. A Charge shown and
 * unticked becomes not done; one not shown (recorded by a colleague
 * meanwhile) is done, as ticked by default.
 */
const closeReview = {
  reviewed: vine.array(vine.number()).distinct().optional(),
  done: vine.array(vine.number()).distinct().optional(),
}

export const visitStatusValidator = vine.create({
  status: vine.enum(VISIT_STATUSES),
  ...closeReview,
})

export const visitCloseValidator = vine.create(closeReview)

/**
 * The Charges a close review leaves unticked.
 */
export function notDoneIn({ reviewed = [], done = [] }: { reviewed?: number[]; done?: number[] }) {
  return reviewed.filter((id) => !done.includes(id))
}

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

/**
 * Hours worked by a Technician on the Visit, or by someone outside the
 * app, named instead.
 */
export const visitHoursValidator = vine.create({
  technicianId: vine.number().optional(),
  workerName: vine
    .string()
    .trim()
    .minLength(1)
    .maxLength(100)
    .optional()
    .requiredIfMissing('technicianId'),
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
