import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { I18n } from '@adonisjs/i18n'
import CompanySettings from '#models/company_settings'
import type Customer from '#models/customer'
import type { Recipient } from '#documents/document_renderer'
import InstalledEquipment from '#models/installed_equipment'
import Item from '#models/item'
import Job from '#models/job'
import Site from '#models/site'
import { formatDate, todayIso } from '#shared/dates'
import { parseAmount } from '#shared/money'
import { own, type TableData, type TemplateField } from '#shared/document_templates'

/**
 * Values that don't fit their fields, as messages by field key.
 */
export class TemplateDataError extends Error {
  constructor(readonly errors: Record<string, string>) {
    super('Invalid template data')
  }
}

/**
 * An Item used on a Job, with the quantity recorded over all its Charges.
 */
export type ItemUsed = {
  id: number
  code: string
  description: string
  unit: string
  quantity: string
}

/**
 * The records chosen in the entity fields, for the history lists of the
 * Site and Installed Equipment (#31).
 */
export type ChosenRecords = {
  siteId: number | null
  equipmentId: number | null
  jobId: number | null
}

export type ResolveOptions = {
  /**
   * Archived Items that may still be chosen: those already on the
   * document a replacement replaces.
   */
  archivedItemIds?: number[]
}

/**
 * The order fields are checked in: the Site first (Installed Equipment is
 * chosen from it and a Job must be at it), then the Job (archived Items are
 * allowed only when used on it), Installed Equipment last.
 */
const CHECK_ORDER: Partial<Record<string, number>> = { site: 0, job: 1, equipment: 3 }
const checkOrder = (field: TemplateField) => CHECK_ORDER[field.type] ?? 2

const MAX_TEXT = { text: 500, long_text: 5000, cell: 500 }
const MAX_ROWS = 200
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const quantityFormat = new Intl.NumberFormat('it-IT', {
  maximumFractionDigits: 3,
  useGrouping: false,
})

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0)
const isValidDate = (value: string) => ISO_DATE.test(value) && DateTime.fromISO(value).isValid

/**
 * Filling a Document Template's fields for one Customer: checks each
 * value against its field (type, required, and which records may be
 * chosen) and turns them, with the built-in placeholders, into the plain
 * strings the body prints. The result, with the chosen records and the
 * Recipient, is what an Issued Document freezes (#31), so later edits to
 * a Site or an Item never change it.
 */
export default class TemplateData {
  static async resolve(
    fields: TemplateField[],
    customer: Customer,
    input: Record<string, unknown>,
    i18n: I18n,
    options: ResolveOptions = {}
  ): Promise<{
    values: Record<string, string>
    tables: Record<string, TableData>
    records: ChosenRecords
    recipient: Recipient
  }> {
    const errors: Record<string, string> = {}
    const values: Record<string, string> = {}
    const tables: Record<string, TableData> = {}
    const fail = (field: TemplateField, key: string, data?: Record<string, unknown>) => {
      errors[field.key] = i18n.t(`errors.templateData.${key}`, data)
    }
    const set = (field: TemplateField, label: string, properties: Record<string, string> = {}) => {
      values[`field.${field.key}`] = label
      for (const [property, value] of Object.entries(properties)) {
        values[`field.${field.key}.${property}`] = value
      }
    }

    const ordered = [...fields].sort((a, b) => checkOrder(a) - checkOrder(b))
    const records: ChosenRecords = { siteId: null, equipmentId: null, jobId: null }
    let site: Site | null = null
    // Archived Items are chosen only when the Job used them, or the original
    // of a replacement already had them
    const archivedAllowed = new Set(options.archivedItemIds ?? [])
    const choosable = (item: Item) => !item.archivedAt || archivedAllowed.has(item.id)

    for (const field of ordered) {
      const value = own(input, field.key)
      if (isEmpty(value)) {
        if (field.required) fail(field, 'required')
        else if (field.type === 'table') tables[field.key] = this.table(field, [])
        else if (field.type === 'boolean') set(field, i18n.t('documents.template.no'))
        else set(field, '', this.emptyProperties(field))
        continue
      }

      switch (field.type) {
        case 'text':
        case 'long_text':
          if (typeof value !== 'string') fail(field, 'invalid')
          else if (value.length > MAX_TEXT[field.type]) fail(field, 'tooLong')
          else set(field, value.trim())
          break
        case 'number':
          if (typeof value !== 'string' || !parseAmount(value)) fail(field, 'number')
          else set(field, value.trim())
          break
        case 'date':
          if (typeof value !== 'string' || !isValidDate(value)) fail(field, 'date')
          else set(field, formatDate(value))
          break
        case 'boolean':
          if (typeof value !== 'boolean') fail(field, 'invalid')
          else set(field, i18n.t(value ? 'documents.template.yes' : 'documents.template.no'))
          break
        case 'choice':
          if (typeof value !== 'string' || !field.options?.includes(value)) fail(field, 'choice')
          else set(field, value)
          break
        case 'site': {
          const found = isId(value) ? await Site.find(value) : null
          if (!found || found.archivedAt) {
            fail(field, 'site')
            break
          }
          site = found
          records.siteId = found.id
          set(field, found.summary, { address: found.address, city: found.city })
          break
        }
        case 'equipment': {
          if (!site) {
            fail(field, 'equipmentNeedsSite')
            break
          }
          const equipment = isId(value)
            ? await InstalledEquipment.query()
                .where('id', value)
                .where('siteId', site.id)
                .whereNull('removedOn')
                .first()
            : null
          if (!equipment) {
            fail(field, 'equipment')
            break
          }
          records.equipmentId = equipment.id
          set(field, equipment.description, {
            make: equipment.make ?? '',
            model: equipment.model ?? '',
            serial_number: equipment.serialNumber ?? '',
            installed_on: formatDate(equipment.installedOn?.toISODate()),
          })
          break
        }
        case 'job': {
          const job = isId(value) ? await Job.find(value) : null
          if (!job || job.customerId !== customer.id) {
            fail(field, 'job')
            break
          }
          // A Job at another Site would pair its work with the wrong place
          if (site && job.siteId !== null && job.siteId !== site.id) {
            fail(field, 'jobSite')
            break
          }
          records.jobId = job.id
          for (const used of await this.itemsUsed(job)) archivedAllowed.add(used.id)
          set(field, `${job.number} – ${job.title}`, { number: job.number, title: job.title })
          break
        }
        case 'item': {
          const item = isId(value) ? await Item.find(value) : null
          if (!item) fail(field, 'item')
          else if (!choosable(item)) fail(field, 'archivedItem')
          else set(field, item.description, { code: item.code, description: item.description })
          break
        }
        case 'items': {
          const ids = Array.isArray(value) && value.every(isId) ? value : null
          const items = ids ? await Item.findMany(ids) : []
          if (!ids || ids.length > MAX_ROWS || new Set(ids).size !== items.length) {
            fail(field, 'item')
            break
          }
          if (!items.every(choosable)) {
            fail(field, 'archivedItem')
            break
          }
          const byId = new Map(items.map((item) => [item.id, item]))
          set(field, ids.map((id) => byId.get(id)!.description).join(', '))
          break
        }
        case 'table': {
          const rows = this.rows(field, value)
          if ('error' in rows) fail(field, rows.error, { row: rows.row })
          else if (rows.length === 0 && field.required) fail(field, 'required')
          else tables[field.key] = this.table(field, rows)
          break
        }
      }
    }

    if (Object.keys(errors).length) throw new TemplateDataError(errors)
    const settings = await CompanySettings.current()
    values['company.name'] = settings.name ?? ''
    values['recipient.name'] = customer.displayName
    values['today'] = formatDate(todayIso())
    return { values, tables, records, recipient: customer.toRecipient() }
  }

  /**
   * The Items used on a Job, from its Item Charges (ADR 0010): each once,
   * in the order first recorded, with the quantities recorded summed.
   */
  static async itemsUsed(job: Job): Promise<ItemUsed[]> {
    const rows = await db
      .from('charges')
      .join('items', 'items.id', 'charges.item_id')
      .where('charges.job_id', job.id)
      .where('charges.kind', 'item')
      .groupBy('items.id')
      .select('items.id', 'items.code', 'items.description', 'items.unit')
      .sum('charges.quantity as quantity')
      .orderByRaw('min(charges.id)')

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      unit: row.unit,
      quantity: quantityFormat.format(row.quantity),
    }))
  }

  private static emptyProperties(field: TemplateField): Record<string, string> {
    return (
      {
        site: { address: '', city: '' },
        equipment: { make: '', model: '', serial_number: '', installed_on: '' },
        job: { number: '', title: '' },
        item: { code: '', description: '' },
      }[field.type as string] ?? {}
    )
  }

  /**
   * A table's rows, a string per column (empty cells arrive as null),
   * with number and date cells checked and blank rows left out; or what is
   * wrong, and in which row (from 1).
   */
  private static rows(
    field: TemplateField,
    value: unknown
  ): string[][] | { error: string; row?: number } {
    const columns = field.columns ?? []
    if (!Array.isArray(value) || value.length > MAX_ROWS) return { error: 'invalid' }
    const isCell = (cell: unknown) =>
      cell === null || (typeof cell === 'string' && cell.length <= MAX_TEXT.cell)
    const rows: string[][] = []
    for (const [index, row] of value.entries()) {
      if (!Array.isArray(row) || row.length !== columns.length || !row.every(isCell)) {
        return { error: 'invalid' }
      }
      const cells = row.map((cell: string | null) => (cell ?? '').trim())
      for (const [position, column] of columns.entries()) {
        const cell = cells[position]
        if (!cell) continue
        if (column.type === 'number' && !parseAmount(cell)) {
          return { error: 'tableNumber', row: index + 1 }
        }
        if (column.type === 'date' && !isValidDate(cell)) {
          return { error: 'tableDate', row: index + 1 }
        }
        if (column.type === 'date') cells[position] = formatDate(cell)
      }
      if (cells.some(Boolean)) rows.push(cells)
    }
    return rows
  }

  private static table(field: TemplateField, rows: string[][]): TableData {
    return { headers: (field.columns ?? []).map((column) => column.label), rows }
  }
}
