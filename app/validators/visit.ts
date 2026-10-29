import vine from '@vinejs/vine'
import { MAX_REPEATED_VISITS, REPEAT_FREQUENCIES, WEEKDAYS } from '#shared/visit_repeats'

/**
 * Users who may be put on a Visit: active Technicians, and anyone already
 * on it (`meta.technicianIds`: deactivated since, or no longer a
 * Technician), who may stay.
 */
const assignable = () =>
  vine.number().exists({
    table: 'users',
    column: 'id',
    filter: (db, _, field) => {
      const kept: number[] = field.meta?.technicianIds ?? []
      db.where((q) =>
        q
          .where((technician) => technician.where('role', 'technician').where('is_active', true))
          .orWhereIn('id', kept)
      )
    },
  })

const technicianIds = () => vine.array(assignable()).minLength(1).distinct()

const date = () => vine.date({ formats: ['YYYY-MM-DD'] })

/** What every Visit planned from the Job page has, whatever its date. */
const plannedVisit = {
  startTime: vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: vine
    .number()
    .withoutDecimals()
    .min(15)
    .max(24 * 60),
  technicianIds: technicianIds(),
  notes: vine.string().trim().maxLength(5000).optional(),
  survey: vine.boolean().optional(),
}

/**
 * A Visit planned from the Job page: day, start time, length, who goes,
 * and whether it is a Survey.
 */
export const visitValidator = vine.create({ date: date(), ...plannedVisit })

/**
 * A Visit to repeat (#177), asked for to see its dates before planning
 * them: from its day, every day, on weekdays or on chosen days of the
 * week, until a date or for a number of Visits.
 */
export const repeatVisitValidator = vine.create({
  date: date(),
  ...plannedVisit,
  repeat: vine.enum(REPEAT_FREQUENCIES),
  weekdays: vine
    .array(vine.number().in([...WEEKDAYS]))
    .distinct()
    .optional()
    .requiredWhen('repeat', '=', 'days'),
  until: date().afterOrSameAs('date').optional().requiredIfMissing('count'),
  count: vine.number().withoutDecimals().min(1).max(MAX_REPEATED_VISITS).optional(),
})

/**
 * The repeated Visits Office confirmed (#177): the dates kept from the
 * list, each planned with the same hours, Technicians and notes.
 */
export const repeatedVisitsValidator = vine.create({
  dates: vine.array(date()).minLength(1).maxLength(MAX_REPEATED_VISITS).distinct(),
  ...plannedVisit,
})

/**
 * Planning a new Visit (#177): optionally copying an existing Visit of the
 * Job ("plan the next Visit").
 */
export const planVisitQueryValidator = vine.create({
  from: vine.number().withoutDecimals().optional(),
})

/**
 * Editing a Visit: as when planning it, except Technicians already on the
 * Visit may stay even if deactivated since.
 */
export const editVisitValidator = vine
  .withMetaData<{ technicianIds: number[] }>()
  .create({ date: date(), ...plannedVisit })

/**
 * A drag-and-drop move on the calendar. Dropping on a lane hands the
 * Visit to that user: an active Technician, or someone already on it
 * (moving within the own lane of someone deactivated, or no longer a
 * Technician, only changes the time).
 */
export const moveVisitValidator = vine.withMetaData<{ technicianIds: number[] }>().create({
  startsAt: vine.date({ formats: ['YYYY-MM-DDTHH:mm'] }),
  fromTechnicianId: vine.number().withoutDecimals().optional(),
  toTechnicianId: assignable().optional(),
})

export const scheduleValidator = vine.create({
  date: vine.date({ formats: ['YYYY-MM-DD'] }).optional(),
  view: vine.enum(['day', 'week'] as const).optional(),
})
