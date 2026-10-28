import { InvoiceSequenceSchema } from '#database/schema'

/**
 * A year's invoice numbering: the number the next finalised Invoice takes.
 * The Admin may set it until that year's first Invoice is finalised.
 */
export default class InvoiceSequence extends InvoiceSequenceSchema {
  static table = 'invoice_sequences'
}
