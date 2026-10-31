import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { INVOICE_STAGES, SUBMISSION_OUTCOMES } from '#shared/invoice_lifecycle'
import { CREDIT_NOTE_NUMBERING_MODES } from '#shared/credit_notes'
import { ORGANISE_BY } from '#shared/invoice_sections'
import { LINE_DISCOUNT_MAX } from '#shared/invoice_totals'
import { UNIT_PRICE_DECIMALS } from '#shared/money'
import { amountRule } from '#validators/rules/amount'
import { quantityRule } from '#validators/rules/quantity'

/**
 * An Item is never sold at a negative price; only deduction lines are.
 */
const noNegativeItemPrice = vine.createRule((value: unknown, _, field: FieldContext) => {
  if (typeof value === 'string' && value.startsWith('-') && field.parent.itemId) {
    field.report('The {{ field }} field must be a valid amount', 'amount', field)
  }
})

// Capped with the price so a line total fits numeric(14,2)
const LINE_QUANTITY_MAX = '99999'
const LINE_PRICE_MAX = '9999999'
// A Legacy Invoice's totals, as Payments are capped
const LEGACY_AMOUNT_MAX = '9999999999'

/**
 * How a draft from a Job's Charges is made (ADR 0017, 0018): how its
 * lines are organised into sections (by kind by default), whether alike
 * Charges are combined (by default) and the last work day it bills.
 */
export const invoiceFromJobValidator = vine.create({
  organiseBy: vine.enum(ORGANISE_BY).optional(),
  combine: vine.boolean().optional(),
  upTo: vine.date({ formats: ['YYYY-MM-DD'] }).optional(),
})

/**
 * Organising a draft again (ADR 0018): both choices are required, as the
 * page always sends them.
 */
export const invoiceOrganiseValidator = vine.create({
  organiseBy: vine.enum(ORGANISE_BY),
  combine: vine.boolean(),
})

export const newInvoiceValidator = vine.create({
  customerId: vine.number().exists({
    table: 'customers',
    column: 'id',
    filter: (db) => {
      db.whereNull('archived_at')
    },
  }),
})

/**
 * The whole draft as edited on the page: global discount, notes and the
 * ordered lines. Archived Items and VAT Codes can't be added, but lines
 * already on the draft keep theirs.
 */
export const invoiceValidator = vine
  .withMetaData<{ itemIds: number[]; vatCodeIds: number[] }>()
  .create({
    discountPercent: vine
      .string()
      .use(amountRule({ decimals: 2, max: '99.99' }))
      .optional(),
    notes: vine.string().trim().maxLength(5000).optional(),
    lines: vine
      .array(
        vine.object({
          // An existing line, kept with its identity; others are new
          id: vine.number().withoutDecimals().positive().optional(),
          itemId: vine
            .number()
            .exists({
              table: 'items',
              column: 'id',
              filter: (db, _, field) => {
                db.where((q) => q.whereNull('archived_at').orWhereIn('id', field.meta.itemIds))
              },
            })
            .optional(),
          description: vine.string().trim().minLength(1).maxLength(1000),
          unit: vine.string().trim().maxLength(10).optional(),
          quantity: vine
            .string()
            .use(quantityRule({ allowNegative: false, max: LINE_QUANTITY_MAX })),
          // Negative only on a line without an Item: a deduction (Advance Invoices)
          unitPrice: vine
            .string()
            .use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: LINE_PRICE_MAX, signed: true }))
            .use(noNegativeItemPrice()),
          discountPercent: vine
            .string()
            .use(amountRule({ decimals: 2, max: LINE_DISCOUNT_MAX }))
            .optional(),
          deductsInvoiceId: vine.number().withoutDecimals().optional(),
          // On a Credit Note, the credited Invoice's line (checked by Invoices.save)
          creditsLineId: vine.number().withoutDecimals().positive().optional(),
          // The Charges the line bills, among the Invoice's own (ADR 0010)
          chargeIds: vine
            .array(vine.number().withoutDecimals().positive())
            .maxLength(500)
            .optional(),
          vatCodeId: vine.number().exists({
            table: 'vat_codes',
            column: 'id',
            filter: (db, _, field) => {
              db.where((q) => q.whereNull('archived_at').orWhereIn('id', field.meta.vatCodeIds))
            },
          }),
          // The position in `sections` of the section it sits in (ADR 0018)
          section: vine.number().withoutDecimals().min(0).max(49).optional(),
        })
      )
      .maxLength(200),
    // Headings over the lines on the PDF, in order (ADR 0018)
    sections: vine
      .array(
        vine.object({
          id: vine.number().withoutDecimals().positive().optional(),
          title: vine.string().trim().minLength(1).maxLength(200),
          showSubtotal: vine.boolean(),
        })
      )
      .maxLength(50)
      .optional(),
    // What the Invoice takes back of each Advance Invoice, VAT included
    deductions: vine
      .array(
        vine.object({
          advanceId: vine.number().withoutDecimals().positive(),
          amount: vine.string().use(amountRule({ decimals: 2, max: '9999999999', positive: true })),
        })
      )
      .maxLength(100)
      .optional(),
  })

export const invoiceNumberingValidator = vine.create({
  nextNumber: vine.number().withoutDecimals().min(1).max(999999),
})

export const creditNoteNumberingValidator = vine.create({
  mode: vine.enum(CREDIT_NOTE_NUMBERING_MODES),
})

export const invoiceStageValidator = vine.create({
  stage: vine.enum(INVOICE_STAGES).optional(),
})

export const submissionOutcomeValidator = vine.create({
  outcome: vine.enum(SUBMISSION_OUTCOMES),
  // The notice's date; today when left out
  noticeOn: vine
    .date({ formats: ['YYYY-MM-DD'] })
    .beforeOrEqual('today')
    .optional(),
  // SDI's identifier for the file, shown on its notices
  sdiId: vine
    .string()
    .trim()
    .regex(/^\d{1,20}$/)
    .optional(),
  // SDI's notice: error codes and description for a Rejection
  notes: vine.string().trim().maxLength(5000).optional(),
})

export const sdiPrefixValidator = vine.create({
  sdiFilePrefix: vine
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]$/),
})

export const paymentValidator = vine.create({
  // A refund is a negative Payment; zero isn't a payment (ADR 0014)
  amount: vine
    .string()
    .use(amountRule({ decimals: 2, max: '9999999999', signed: true, nonZero: true })),
  paidOn: vine.date({ formats: ['YYYY-MM-DD'] }).beforeOrEqual('today'),
  note: vine.string().trim().maxLength(255).optional(),
})

/**
 * A Legacy Invoice (#27) as entered from its PDF. Archived Customers and
 * VAT Codes can't be picked, but one already kept stays (`customerId`,
 * `vatCodeIds`). The PDF is required when it is first recorded; when it
 * is changed, a new one replaces it. With `paid`, a Payment for its total
 * is recorded on `paidOn`, by default its date; a day before it is warned
 * about, never refused (ADR 0014).
 */
export const legacyInvoiceValidator = vine
  .withMetaData<{ customerId: number | null; vatCodeIds: number[]; creating: boolean }>()
  .create({
    customerId: vine.number().exists({
      table: 'customers',
      column: 'id',
      filter: (db, _, field) => {
        db.where((q) => q.whereNull('archived_at').orWhere('id', field.meta.customerId ?? 0))
      },
    }),
    jobId: vine.number().exists({ table: 'jobs', column: 'id' }).optional(),
    // As printed; a Credit Note refers to it in FatturaPA's 20 characters
    number: vine.string().trim().minLength(1).maxLength(20),
    issuedOn: vine.date({ formats: ['YYYY-MM-DD'] }).beforeOrEqual('today'),
    dueOn: vine
      .date({ formats: ['YYYY-MM-DD'] })
      .afterOrSameAs('issuedOn')
      .optional(),
    taxable: vine.string().use(amountRule({ decimals: 2, max: LEGACY_AMOUNT_MAX })),
    vat: vine.string().use(amountRule({ decimals: 2, max: LEGACY_AMOUNT_MAX })),
    total: vine.string().use(amountRule({ decimals: 2, max: LEGACY_AMOUNT_MAX, positive: true })),
    advance: vine.boolean().optional(),
    vatRows: vine
      .array(
        vine.object({
          vatCodeId: vine.number().exists({
            table: 'vat_codes',
            column: 'id',
            filter: (db, _, field) => {
              db.where((q) => q.whereNull('archived_at').orWhereIn('id', field.meta.vatCodeIds))
            },
          }),
          taxable: vine
            .string()
            .use(amountRule({ decimals: 2, max: LEGACY_AMOUNT_MAX, positive: true })),
        })
      )
      .maxLength(20)
      .optional(),
    paid: vine.boolean().optional(),
    paidOn: vine
      .date({ formats: ['YYYY-MM-DD'] })
      .beforeOrEqual('today')
      .optional(),
    pdf: vine
      .file({ size: '20mb', extnames: ['pdf'] })
      .optional()
      .requiredWhen((field) => field.meta.creating),
  })

/**
 * What a new Legacy Invoice starts from: a Customer, or a Job (its
 * Customer's).
 */
export const newLegacyInvoiceValidator = vine.create({
  customerId: vine.number().withoutDecimals().positive().optional(),
  jobId: vine.number().withoutDecimals().positive().optional(),
})
