import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import Item from '#models/item'
import ItemDocument from '#models/item_document'
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
 * Item Documents: uploaded and deleted by Admin and Office, opened by any
 * business role (Technicians read manuals on site).
 */
export default class ItemDocumentsController {
  async store({ params, request, response, session, i18n }: HttpContext) {
    const item = await Item.findOrFail(params.id)
    const { title, file } = await request.validateUsing(itemDocumentValidator)

    const extname = file.extname!.toLowerCase()
    const fileName = `${randomUUID()}.${extname}`
    const directory = `items/${item.id}`
    await file.move(storagePath(directory), { name: fileName })

    await item.related('documents').create({
      title,
      filePath: `${directory}/${fileName}`,
      originalName: file.clientName.slice(0, 255),
      mimeType: MIME_TYPES[extname],
      sizeBytes: file.size,
    })

    session.flash('success', i18n.t('flash.documentUploaded'))
    response.redirect().back()
  }

  async show({ params, response }: HttpContext) {
    const document = await ItemDocument.findOrFail(params.id)

    response.header('content-type', document.mimeType)
    response.header('x-content-type-options', 'nosniff')
    response.header(
      'content-disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(document.originalName)}`
    )
    return response.download(storagePath(document.filePath))
  }

  async destroy({ params, response, session, i18n }: HttpContext) {
    const document = await ItemDocument.findOrFail(params.id)

    await document.delete()
    await unlink(storagePath(document.filePath)).catch(() => {})

    session.flash('success', i18n.t('flash.documentDeleted', { title: document.title }))
    response.redirect().back()
  }
}
