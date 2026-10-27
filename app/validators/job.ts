import vine from '@vinejs/vine'
import { JOB_KINDS, JOB_STATUSES, WORK_CATEGORIES } from '#models/job'

export const jobValidator = vine.create({
  customerId: vine.number().exists({ table: 'customers', column: 'id' }),
  siteId: vine.number().exists({ table: 'sites', column: 'id' }).optional(),
  kind: vine.enum(JOB_KINDS),
  workCategory: vine.enum(WORK_CATEGORIES),
  title: vine.string().trim().minLength(1).maxLength(255),
  description: vine.string().trim().maxLength(5000).optional(),
})

/**
 * `status` filters the list: a single status, or "all". Without it the
 * list shows active (not cancelled) Jobs.
 */
export const jobSearchValidator = vine.create({
  q: vine.string().trim().maxLength(100).optional(),
  status: vine.enum([...JOB_STATUSES, 'work_complete', 'all'] as const).optional(),
  page: vine.number().min(1).optional(),
})

export const customerPickerValidator = vine.create({
  q: vine.string().trim().maxLength(100).optional(),
})
