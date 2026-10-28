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
 * A Visit planned from the Job page: day, start time, length, who goes,
 * and whether it is a Survey.
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
  survey: vine.boolean().optional(),
})

/**
 * Editing a Visit: as when planning it, except Technicians already on the
 * Visit may stay even if deactivated since.
 */
export const editVisitValidator = vine.withMetaData<{ technicianIds: number[] }>().create({
  date: vine.date({ formats: ['YYYY-MM-DD'] }),
  startTime: vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: vine
    .number()
    .withoutDecimals()
    .min(15)
    .max(24 * 60),
  technicianIds: vine
    .array(
      vine.number().exists({
        table: 'users',
        column: 'id',
        filter: (db, _, field) => {
          // Anyone already on the Visit may stay (deactivated, or no longer
          // a Technician); new members must be active Technicians
          db.where((q) =>
            q
              .where((technician) =>
                technician.where('role', 'technician').where('is_active', true)
              )
              .orWhereIn('id', field.meta.technicianIds)
          )
        },
      })
    )
    .minLength(1)
    .distinct(),
  notes: vine.string().trim().maxLength(5000).optional(),
  survey: vine.boolean().optional(),
})

/**
 * A drag-and-drop move on the calendar.
 */
export const moveVisitValidator = vine.create({
  startsAt: vine.date({ formats: ['YYYY-MM-DDTHH:mm'] }),
  fromTechnicianId: vine.number().optional(),
  toTechnicianId: vine
    .number()
    .exists({
      table: 'users',
      column: 'id',
      // A new Technician must be active; dragging within the own lane of
      // someone deactivated or no longer a Technician only changes the time
      filter: (db, _, field) => {
        db.where((q) =>
          q
            .where((technician) => technician.where('role', 'technician').where('is_active', true))
            .orWhere('id', field.parent.fromTechnicianId ?? 0)
        )
      },
    })
    .optional(),
})

export const scheduleValidator = vine.create({
  date: vine.date({ formats: ['YYYY-MM-DD'] }).optional(),
  view: vine.enum(['day', 'week'] as const).optional(),
})
