import vine from '@vinejs/vine'
import { JOB_STATUSES } from '#models/job'
import { WORK_CATEGORIES } from '#shared/jobs'

/**
 * Archived Customers and Sites can't be picked, but a Job keeps its own.
 */
const notArchived = (
  table: string,
  current: (meta: { customerId?: number; siteId?: number }) => number | undefined
) =>
  vine.number().exists({
    table,
    column: 'id',
    filter: (db, _, field) => {
      db.where((q) => q.whereNull('archived_at').orWhere('id', current(field.meta) ?? 0))
    },
  })

export const jobValidator = vine.withMetaData<{ customerId?: number; siteId?: number }>().create({
  customerId: notArchived('customers', (meta) => meta.customerId),
  siteId: notArchived('sites', (meta) => meta.siteId).optional(),
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
  status: vine
    .enum([...JOB_STATUSES, 'work_complete', 'invoiced', 'closed', 'all'] as const)
    .optional(),
  page: vine.number().min(1).optional(),
})

export const customerPickerValidator = vine.create({
  q: vine.string().trim().maxLength(100).optional(),
})
