import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
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

    const path = storagePath(document.filePath)
    if (!existsSync(path)) return response.notFound()

    response.header('content-type', document.mimeType)
    response.header('x-content-type-options', 'nosniff')
    // Even a crafted file can't run scripts in the app's origin
    response.header('content-security-policy', 'sandbox')
    // attachment() builds a standards-compliant header for any file name
    return response.attachment(path, document.originalName, 'inline')
  }

  async destroy({ params, response, session, i18n }: HttpContext) {
    const document = await ItemDocument.findOrFail(params.id)

    await document.delete()
    await unlink(storagePath(document.filePath)).catch(() => {})

    session.flash('success', i18n.t('flash.documentDeleted', { title: document.title }))
    response.redirect().back()
  }
}
