import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import Item from '#models/item'
import ItemDocument from '#models/item_document'
import Visit from '#models/visit'
import { storagePath } from '#services/storage'
import { itemDocumentValidator } from '#validators/item_document'
import type { HttpContext } from '@adonisjs/core/http'

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/**
 * Item Documents: uploaded, deleted and opened by Admin and Office;
 * Technicians open those of the equipment at a Visit's Site, from the
 * Visit (they read manuals on site).
 */
export default class ItemDocumentsController {
  async store({ params, request, response, session, i18n }: HttpContext) {
    const item = await Item.findOrFail(params.id)
    const { title, attachment: file } = await request.validateUsing(itemDocumentValidator)

    const extname = file.extname!.toLowerCase()
    const fileName = `${randomUUID()}.${extname}`
    const directory = `items/${item.id}`
    await file.move(storagePath(directory), { name: fileName })

    try {
      await item.related('documents').create({
        title,
        filePath: `${directory}/${fileName}`,
        originalName: file.clientName.slice(0, 255),
        mimeType: MIME_TYPES[extname],
        sizeBytes: file.size,
      })
    } catch (error) {
      // Don't leave a file that no row points to
      await unlink(storagePath(directory, fileName)).catch(() => {})
      throw error
    }

    session.flash('success', i18n.t('flash.documentUploaded'))
    response.redirect().back()
  }

  async show({ params, response }: HttpContext) {
    const document = await ItemDocument.findOrFail(params.id)
    return this.send(document, response)
  }

  /**
   * From a Visit: only documents of an Item installed at the Visit's Site
   * (equipment not removed), as the Visit page lists them.
   */
  async showFromVisit({ params, response, bouncer }: HttpContext) {
    const visit = await Visit.query().where('id', params.id).preload('job').firstOrFail()
    await bouncer.authorize('viewVisit', visit)
    const document = await ItemDocument.query()
      .where('id', params.documentId)
      .whereIn('itemId', (equipment) =>
        equipment
          .from('installed_equipment')
          .select('item_id')
          .where('site_id', visit.job.siteId ?? 0)
          .whereNull('removed_on')
      )
      .first()
    if (!document) return response.notFound()
    return this.send(document, response)
  }

  async destroy({ params, response, session, i18n }: HttpContext) {
    const document = await ItemDocument.findOrFail(params.id)

    await document.delete()
    await unlink(storagePath(document.filePath)).catch(() => {})

    session.flash('success', i18n.t('flash.documentDeleted', { title: document.title }))
    response.redirect().back()
  }

  private send(document: ItemDocument, response: HttpContext['response']) {
    const path = storagePath(document.filePath)
    if (!existsSync(path)) return response.notFound()

    response.header('x-content-type-options', 'nosniff')
    // Images can't run scripts even if crafted. Not for PDFs: a sandboxed
    // page blocks the browser's built-in PDF viewer.
    if (document.mimeType.startsWith('image/')) {
      response.header('content-security-policy', 'sandbox')
    }
    // attachment() builds a standards-compliant header for any file name
    return response.attachment(path, document.originalName, 'inline')
  }
}
