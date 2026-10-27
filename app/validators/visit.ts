import vine from '@vinejs/vine'

const technicianIds = () =>
  vine
    .array(
      vine.number().exists({
        table: 'users',
        column: 'id',
        filter: (db) => {
          db.where('role', 'technician').where('is_active', true)
        },
      })
    )
    .minLength(1)
    .distinct()

/**
 * A Visit planned from the Job page: day, start time, length and who goes.
 */
export const visitValidator = vine.create({
  date: vine.date({ formats: ['YYYY-MM-DD'] }),
  startTime: vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: vine
    .number()
    .withoutDecimals()
    .min(15)
    .max(24 * 60),
  technicianIds: technicianIds(),
  notes: vine.string().trim().maxLength(5000).optional(),
})

/**
 * A drag-and-drop move on the calendar.
 */
export const moveVisitValidator = vine.create({
  startsAt: vine.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/),
  fromTechnicianId: vine.number().optional(),
  toTechnicianId: vine
    .number()
    .exists({
      table: 'users',
      column: 'id',
      filter: (db) => {
        db.where('role', 'technician').where('is_active', true)
      },
    })
    .optional(),
})

export const scheduleValidator = vine.create({
  date: vine.date({ formats: ['YYYY-MM-DD'] }).optional(),
  view: vine.enum(['day', 'week'] as const).optional(),
})
