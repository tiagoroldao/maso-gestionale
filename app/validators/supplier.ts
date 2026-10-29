import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import db from '@adonisjs/lucid/services/db'
import { isValidVatNumber } from '#fiscal/italian_ids'
import { taxCodeRule } from '#validators/rules/italian_ids'
import { quantityRule } from '#validators/rules/quantity'
import { amountRule } from '#validators/rules/amount'
import { UNIT_PRICE_DECIMALS } from '#shared/money'

/**
 * A Supplier's VAT number: an Italian Partita IVA when the country is
 * IT, letters and digits otherwise; spaces removed, upper-cased.
 */
const supplierVatNumber = vine.createRule((value: unknown, _: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  const normalized = value.replace(/\s+/g, '').toUpperCase()
  const country = String(field.parent.vatCountry ?? '').toUpperCase()
  const valid =
    country === 'IT' ? isValidVatNumber(normalized) : /^[A-Z0-9]{2,28}$/.test(normalized)
  if (!valid) {
    field.report('The {{ field }} field must be a valid VAT number', 'vatNumber', field)
    return
  }
  field.mutate(normalized, field)
})

/**
 * One Supplier per VAT number (country and code).
 */
const supplierVatFree = vine.createRule(
  async (value: unknown, _: undefined, field: FieldContext) => {
    if (typeof value !== 'string' || !field.isValid) return
    const taken = await db
      .from('suppliers')
      .where('vat_country', String(field.parent.vatCountry).toUpperCase())
      .where('vat_number', value)
      .first()
    if (taken) {
      field.report('A Supplier with this VAT number exists', 'supplierVatNumber.taken', field)
    }
  }
)

const optionalText = (max: number) => vine.string().trim().maxLength(max).optional()

/**
 * The details Office keeps on a Supplier.
 */
const details = {
  name: vine.string().trim().minLength(1).maxLength(255),
  taxCode: vine.string().use(taxCodeRule()).optional(),
  street: optionalText(255),
  postalCode: optionalText(10),
  city: optionalText(255),
  province: vine
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  email: vine.string().trim().email().maxLength(254).optional(),
  phone: optionalText(50),
}

/**
 * A Supplier created by hand: its VAT number, which no other Supplier has.
 */
export const newSupplierValidator = vine.create({
  vatCountry: vine
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  vatNumber: vine.string().use(supplierVatNumber()).use(supplierVatFree()),
  ...details,
})

/**
 * A Supplier's details; its VAT number, which its invoices carry, stays.
 */
export const supplierValidator = vine.create(details)

/**
 * A FatturaPA file by its name: `.xml`, or `.p7m` when signed. Not by its
 * content's magic number: an XML file without a declaration has none, and
 * the file is read (and refused if need be) anyway.
 */
const fatturaFileName = vine.createRule((value: unknown, _: undefined, field: FieldContext) => {
  const name = (value as { clientName?: unknown } | null)?.clientName
  if (typeof name !== 'string' || !/\.(xml|p7m)$/i.test(name)) {
    field.report('The {{ field }} must be an XML or .p7m file', 'file.extname', field)
  }
})

/**
 * A Supplier Invoice uploaded by Office: FatturaPA XML, or signed (.p7m).
 */
export const supplierInvoiceUploadValidator = vine.create({
  invoice: vine.file({ size: '10mb' }).use(fatturaFileName()),
})

/**
 * The cost Office confirms for a line (#210): the unit cost in euro, with
 * the 4 decimals unit prices keep (left out: the line's default), and
 * whether it becomes the Item's purchase price (left out: only when no
 * newer receipt has a cost).
 */
const confirmedCost = {
  unitCost: vine
    .string()
    .use(amountRule({ decimals: UNIT_PRICE_DECIMALS, max: '9999999999' }))
    .optional(),
  updatePurchasePrice: vine.boolean().optional(),
}

/**
 * A Supplier Invoice line received onto an Item (#199): the quantity in
 * the Item's unit, with the 3 decimals stock keeps, the day the goods
 * came in, and the cost confirmed (#210).
 */
export const receiveLineValidator = vine.create({
  itemId: vine.number().exists({ table: 'items', column: 'id' }),
  quantity: vine.string().use(quantityRule({ allowNegative: false })),
  occurredOn: vine.date({ formats: ['YYYY-MM-DD'] }).beforeOrEqual('today'),
  ...confirmedCost,
})

/**
 * A Supplier Invoice line already received by hand onto an Item (#210):
 * optionally the earlier receipt, the quantity in the Item's unit (for
 * the default cost) and the cost confirmed.
 */
export const alreadyReceivedLineValidator = vine.create({
  itemId: vine.number().exists({ table: 'items', column: 'id' }),
  receiptId: vine.number().withoutDecimals().positive().optional(),
  quantity: vine.string().use(quantityRule({ allowNegative: false })),
  ...confirmedCost,
})

/** Whether a Supplier Invoice spreads its discounts over its lines' costs (#210) */
export const spreadDiscountsValidator = vine.create({ spreadDiscounts: vine.boolean() })

/**
 * Sending a Supplier Invoice to legal archiving again (#214), with SDI's
 * identifier for the file when it has none (an upload): the intermediary
 * needs it, as on the Agenzia delle Entrate portal or the metadata file
 */
export const supplierInvoiceArchivingValidator = vine.create({
  sdiId: vine
    .string()
    .trim()
    .regex(/^\d{1,20}$/)
    .optional(),
})

/**
 * The invoice page's Items picked for lines still to handle, by line id
 * (`pick[12]=34`), instead of the suggested ones (#210)
 */
export const supplierInvoicePageValidator = vine.create({
  pick: vine.record(vine.number().withoutDecimals().positive()).optional(),
})

/** The period of Supplier Invoices to export, by invoice date, both days included */
export const supplierInvoiceExportValidator = vine.create({
  issuedFrom: vine.date({ formats: ['YYYY-MM-DD'] }),
  issuedTo: vine.date({ formats: ['YYYY-MM-DD'] }).afterOrSameAs('issuedFrom'),
})

/** A page of the inbox or the Supplier list */
export const pageValidator = vine.create({ page: vine.number().min(1).optional() })
