import vine from '@vinejs/vine'

/**
 * Manuals, datasheets and similar: PDFs or images only, so they open
 * safely in the browser.
 */
export const itemDocumentValidator = vine.create({
  title: vine.string().trim().minLength(1).maxLength(255),
  file: vine.file({ size: '20mb', extnames: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] }),
})
