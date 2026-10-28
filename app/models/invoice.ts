import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { InvoiceSchema } from '#database/schema'
import Customer from '#models/customer'
import Job from '#models/job'
import InvoiceLine from '#models/invoice_line'
import { invoiceTotals } from '#shared/invoice_totals'
import { formatInvoiceNumber } from '#shared/invoice_numbers'
import type { PaymentMethod } from '#shared/payments'
import type { InvoiceStatus } from '#shared/invoice_lifecycle'
import InvoiceSubmission from '#models/invoice_submission'
import Payment from '#models/payment'
import { sumAmounts } from '#shared/money'
import type { LiquidationStatus, SoleShareholder } from '#shared/company'
import { credits, type DocumentType, type NumberingSeries } from '#shared/credit_notes'

export { INVOICE_STATUSES, type InvoiceStatus } from '#shared/invoice_lifecycle'

/**
 * The Customer as invoiced, copied when the Invoice is finalised.
 */
export type CustomerSnapshot = {
  type: string
  name: string
  firstName: string | null
  lastName: string | null
  vatNumber: string | null
  taxCode: string | null
  sdiCode: string
  pec: string | null
  street: string
  streetNumber: string | null
  postalCode: string
  city: string
  province: string
}

/**
 * The issuing company, copied from Company settings when finalised.
 */
export type CompanySnapshot = {
  name: string
  vatNumber: string
  taxCode: string | null
  taxRegime: string
  street: string
  streetNumber: string | null
  postalCode: string
  city: string
  province: string
  email: string | null
  phone: string | null
  iban: string | null
  /** Registro Imprese (IscrizioneREA); absent before it was recorded */
  rea?: {
    office: string
    number: string
    shareCapital: string | null
    soleShareholder: SoleShareholder | null
    liquidationStatus: LiquidationStatus
  } | null
}

/**
 * A request for payment to a Customer, or a Credit Note crediting one
 * (`documentType`, ADR 0014). A draft has no number; finalising numbers
 * and dates it, copies the Customer and company onto it, and makes it a
 * fiscal document that no longer changes.
 */
export default class Invoice extends InvoiceSchema {
  declare status: InvoiceStatus
  declare documentType: DocumentType
  declare series: NumberingSeries | null
  declare customerSnapshot: CustomerSnapshot | null
  declare companySnapshot: CompanySnapshot | null
  declare paymentMethod: PaymentMethod | null

  /**
   * "12/2026" once finalised ("NC12/2026" in the Credit Notes' own
   * series); drafts have no number.
   */
  get formattedNumber() {
    return this.number && this.year
      ? formatInvoiceNumber(this.number, this.year, this.series ?? 'invoice')
      : null
  }

  get isCreditNote() {
    return this.documentType === 'credit_note'
  }

  @belongsTo(() => Customer)
  declare customer: BelongsTo<typeof Customer>

  /** The Job invoiced; Invoices without one are direct sales */
  @belongsTo(() => Job)
  declare job: BelongsTo<typeof Job>

  @hasMany(() => InvoiceLine)
  declare lines: HasMany<typeof InvoiceLine>

  @hasMany(() => InvoiceSubmission)
  declare submissions: HasMany<typeof InvoiceSubmission>

  @hasMany(() => Payment)
  declare payments: HasMany<typeof Payment>

  /** A Credit Note's Invoice, the one it credits */
  @belongsTo(() => Invoice, { foreignKey: 'creditsInvoiceId' })
  declare creditedInvoice: BelongsTo<typeof Invoice>

  /** An Invoice's Credit Notes, drafts included */
  @hasMany(() => Invoice, { foreignKey: 'creditsInvoiceId' })
  declare creditNotes: HasMany<typeof Invoice>

  /**
   * What the preloaded Credit Notes credit: those past draft (credits()).
   */
  get credited() {
    return sumAmounts(
      this.creditNotes.filter((note) => credits(note.status)).map((note) => note.total ?? '0')
    )
  }

  /**
   * The sum of the preloaded Payments.
   */
  get paid() {
    return sumAmounts(this.payments.map((payment) => payment.amount))
  }

  /**
   * Totals and VAT summary, from the preloaded lines.
   */
  get totals() {
    return invoiceTotals(
      this.lines.map((line) => line.totalsLine),
      this.discountPercent
    )
  }
}
