import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { I18n } from '@adonisjs/i18n'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import CompanySettings from '#models/company_settings'
import type Customer from '#models/customer'
import DocumentTemplate from '#models/document_template'
import DocumentTemplateVersion from '#models/document_template_version'
import InstalledEquipment from '#models/installed_equipment'
import IssuedDocument from '#models/issued_document'
import Item from '#models/item'
import Job from '#models/job'
import Site from '#models/site'
import type User from '#models/user'
import DocumentRenderer, { type CompanyDetails } from '#documents/document_renderer'
import { issuedDocument } from '#documents/issued_document'
import DocumentTemplates from '#services/document_templates'
import { storagePath } from '#services/storage'
import TemplateData from '#services/template_data'
import { formatDate } from '#shared/dates'
import { own, type TemplateField, type TemplatePrefill } from '#shared/document_templates'
import { ADVISORY_LOCKS } from '#services/advisory_locks'

/**
 * Why an Issued Document can't be issued: its template was archived, or
 * the original already has a replacement.
 */
export class IssuingRefusedError extends Error {
  constructor(readonly reason: 'templateArchived' | 'alreadyReplaced') {
    super(reason)
  }
}

/**
 * The document's PDF was stored, but its file is no longer in storage.
 */
export class StoredPdfMissingError extends Error {
  constructor(readonly path: string) {
    super(`Stored PDF missing: ${path}`)
  }
}

/**
 * One row of an Issued Document history list.
 */
export type IssuedDocumentRow = {
  id: number
  number: string
  title: string
  issuedOn: string
  customer: string
  replaced: boolean
}

/**
 * Issuing documents from Document Templates (#31): fills the template's
 * current version through TemplateData, takes the template's next number
 * for the year, and stores a frozen copy of everything printed.
 */
export default class IssuedDocuments {
  /**
   * Issues `template` for `customer` from the filled-in fields; with
   * `original`, as its replacement. Throws TemplateDataError when a value
   * doesn't fit its field, IssuingRefusedError when issuing isn't allowed.
   */
  static async issue(
    template: DocumentTemplate,
    customer: Customer,
    input: Record<string, unknown>,
    i18n: I18n,
    user: User | null,
    original: IssuedDocument | null = null
  ) {
    const version = await DocumentTemplates.current(template)
    const archivedItemIds = original ? await this.itemIdsOf(original) : []
    const resolved = await TemplateData.resolve(version.fields, customer, input, i18n, {
      archivedItemIds,
    })
    const company = this.companyDetails(await CompanySettings.current())

    return db.transaction(async (trx) => {
      // Shared: an archive waits for this issue, and this sees one done before
      const current = await DocumentTemplate.query({ client: trx })
        .where('id', template.id)
        .forShare()
        .firstOrFail()
      if (current.archivedAt) throw new IssuingRefusedError('templateArchived')
      if (original) {
        const locked = await IssuedDocument.query({ client: trx })
          .where('id', original.id)
          .forUpdate()
          .firstOrFail()
        if (locked.replacedById !== null) throw new IssuingRefusedError('alreadyReplaced')
      }

      // Dated after the lock, so a later number never gets an earlier date
      // and the year always matches the date
      await trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [
        ADVISORY_LOCKS.issuedDocumentNumbering,
        template.id,
      ])
      const today = DateTime.now().startOf('day')
      const document = await IssuedDocument.create(
        {
          documentTemplateId: template.id,
          documentTemplateVersionId: version.id,
          year: today.year,
          sequence: await this.nextSequence(trx, template.id, today.year),
          issuedOn: today,
          customerId: customer.id,
          siteId: resolved.records.siteId,
          installedEquipmentId: resolved.records.equipmentId,
          jobId: resolved.records.jobId,
          recipient: resolved.recipient,
          company,
          values: { ...resolved.values, today: formatDate(today.toISODate()) },
          tables: resolved.tables,
          input: this.keptInput(version.fields, input),
          createdBy: user?.id ?? null,
        },
        { client: trx }
      )
      // The one change the trigger allows: marking the original replaced
      if (original) {
        await trx
          .from('issued_documents')
          .where('id', original.id)
          .whereNull('replaced_by_id')
          .update({ replaced_by_id: document.id })
      }
      return document
    })
  }

  /**
   * The document's PDF: the stored one, or, the first time, rendered from
   * the frozen copy and stored, so it never changes afterwards. Throws
   * PdfConversionError when it must be rendered and can't be.
   */
  static async pdf(
    document: IssuedDocument,
    i18n: I18n,
    renderer: DocumentRenderer = new DocumentRenderer()
  ): Promise<Buffer> {
    if (document.pdfPath) return this.storedPdf(document.pdfPath)

    const pdf = await renderer.renderPdf(await issuedDocument(document, i18n))
    // A file of its own: a concurrent first render can't overwrite it
    const path = `issued-documents/${document.id}/${randomUUID()}.pdf`
    await mkdir(dirname(storagePath(path)), { recursive: true })
    await writeFile(storagePath(path), pdf)
    // The other change the trigger allows: the path, once
    const stored = await db
      .from('issued_documents')
      .where('id', document.id)
      .whereNull('pdf_path')
      .update({ pdf_path: path }, ['id'])
    if (stored.length === 0) {
      // Another request stored one first: serve that one
      await unlink(storagePath(path)).catch(() => {})
      await document.refresh()
      return this.storedPdf(document.pdfPath!)
    }
    document.pdfPath = path
    return pdf
  }

  /**
   * The values to prefill a replacement of `original` with, for the
   * template's current fields: each field the original had under the same
   * key and type, with chosen records labelled as they are now.
   */
  static async prefill(original: IssuedDocument, fields: TemplateField[]) {
    const version = await DocumentTemplateVersion.findOrFail(original.documentTemplateVersionId)
    const before = new Map(version.fields.map((field) => [field.key, field.type]))
    const values: Record<string, TemplatePrefill> = {}

    for (const field of fields) {
      const value = own(original.input, field.key)
      if (before.get(field.key) !== field.type || value === undefined || value === null) continue
      const prefill = await this.prefillValue(field, value)
      if (prefill !== null) values[field.key] = prefill
    }
    return values
  }

  /**
   * Issued Documents matching `where` (a Customer, Site or Installed
   * Equipment), newest first, as history rows.
   */
  static async history(
    where: Partial<Record<'customerId' | 'siteId' | 'installedEquipmentId', number>>
  ): Promise<IssuedDocumentRow[]> {
    const query = IssuedDocument.query()
      .preload('version')
      .preload('customer')
      .orderBy([
        { column: 'issuedOn', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
    for (const [column, id] of Object.entries(where)) query.where(column, id)
    const documents = await query
    return documents.map((document) => ({
      id: document.id,
      number: document.number,
      title: document.version.name,
      issuedOn: document.issuedOn.toISODate()!,
      customer: document.customer.displayName,
      replaced: document.replacedById !== null,
    }))
  }

  private static async storedPdf(path: string) {
    try {
      return await readFile(storagePath(path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StoredPdfMissingError(path)
      throw error
    }
  }

  /**
   * The input as filled in, only for the template's own fields: anything
   * else the request carried isn't kept.
   */
  private static keptInput(fields: TemplateField[], input: Record<string, unknown>) {
    return Object.fromEntries(
      fields.flatMap((field) => {
        const value = own(input, field.key)
        return value === undefined ? [] : [[field.key, value]]
      })
    )
  }

  private static async nextSequence(
    trx: TransactionClientContract,
    templateId: number,
    year: number
  ) {
    const row = await trx
      .from('issued_documents')
      .where('document_template_id', templateId)
      .where('year', year)
      .max('sequence as last')
      .first()
    return Number(row?.last ?? 0) + 1
  }

  /**
   * The Items chosen in an Issued Document's Item fields.
   */
  private static async itemIdsOf(document: IssuedDocument) {
    const version = await DocumentTemplateVersion.findOrFail(document.documentTemplateVersionId)
    return version.fields.flatMap((field) => {
      const value = own(document.input, field.key)
      if (field.type === 'item' && typeof value === 'number') return [value]
      if (field.type === 'items' && Array.isArray(value)) return value as number[]
      return []
    })
  }

  private static async prefillValue(
    field: TemplateField,
    value: unknown
  ): Promise<TemplatePrefill | null> {
    const id = typeof value === 'number' ? value : null
    switch (field.type) {
      case 'site': {
        const site = id ? await Site.find(id) : null
        return site && { id: site.id, label: site.summary }
      }
      case 'equipment': {
        const equipment = id ? await InstalledEquipment.find(id) : null
        return equipment && { id: equipment.id, label: equipment.description }
      }
      case 'job': {
        const job = id ? await Job.find(id) : null
        return job && { id: job.id, label: `${job.number} – ${job.title}` }
      }
      case 'item': {
        const item = id ? await Item.find(id) : null
        return item && { id: item.id, label: item.description }
      }
      case 'items': {
        const ids = Array.isArray(value) ? (value as number[]) : []
        const items = await Item.findMany(ids)
        const byId = new Map(items.map((item) => [item.id, item]))
        return ids
          .filter((itemId) => byId.has(itemId))
          .map((itemId) => ({ id: itemId, label: byId.get(itemId)!.description }))
      }
      case 'table': {
        // Rows only while the columns still match them
        const width = field.columns?.length ?? 0
        const rows = Array.isArray(value) ? (value as (string | null)[][]) : []
        if (!rows.every((row) => Array.isArray(row) && row.length === width)) return null
        return rows.map((row) => row.map((cell) => cell ?? ''))
      }
      case 'boolean':
        return typeof value === 'boolean' ? value : null
      default:
        return typeof value === 'string' ? value : null
    }
  }

  private static companyDetails(settings: CompanySettings): CompanyDetails {
    return {
      name: settings.name,
      street: settings.street,
      streetNumber: settings.streetNumber,
      postalCode: settings.postalCode,
      city: settings.city,
      province: settings.province,
      vatNumber: settings.vatNumber,
      taxCode: settings.taxCode,
      email: settings.email,
      phone: settings.phone,
    }
  }
}
