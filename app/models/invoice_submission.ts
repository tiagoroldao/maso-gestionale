import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { InvoiceSubmissionSchema } from '#database/schema'
import Invoice from '#models/invoice'

export const SUBMISSION_OUTCOMES = ['delivered', 'not_deliverable', 'rejected'] as const
export type SubmissionOutcome = (typeof SUBMISSION_OUTCOMES)[number]

/**
 * One sending of a finalised Invoice to SDI: prepared (its file name and
 * progressive reserved), confirmed as uploaded, then given SDI's outcome.
 */
export default class InvoiceSubmission extends InvoiceSubmissionSchema {
  static table = 'invoice_submissions'

  declare outcome: SubmissionOutcome | null

  @belongsTo(() => Invoice)
  declare invoice: BelongsTo<typeof Invoice>
}
