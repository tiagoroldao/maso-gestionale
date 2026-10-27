import vine from '@vinejs/vine'
import { VISIT_STATUSES } from '#models/visit'

export const visitStatusValidator = vine.create({
  status: vine.enum(VISIT_STATUSES),
})

export const visitNoteValidator = vine.create({
  body: vine.string().trim().minLength(1).maxLength(5000),
})

/**
 * Phone photos: browsers convert HEIC to JPEG when uploading from the
 * camera, so common web image types are enough.
 */
export const visitPhotoValidator = vine.create({
  photo: vine.file({ size: '15mb', extnames: ['jpg', 'jpeg', 'png', 'webp'] }),
})
