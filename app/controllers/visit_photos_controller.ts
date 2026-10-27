import { existsSync } from 'node:fs'
import VisitPhoto from '#models/visit_photo'
import Visit from '#models/visit'
import { storagePath } from '#services/storage'
import type { HttpContext } from '@adonisjs/core/http'

export default class VisitPhotosController {
  /**
   * A photo, for the Visit's Technicians and for Admin and Office.
   */
  async show({ params, response, bouncer }: HttpContext) {
    const photo = await VisitPhoto.findOrFail(params.id)
    const visit = await Visit.findOrFail(photo.visitId)
    await bouncer.authorize('viewVisit', visit)

    const path = storagePath(photo.filePath)
    if (!existsSync(path)) return response.notFound()

    response.header('x-content-type-options', 'nosniff')
    response.header('content-security-policy', 'sandbox')
    response.header('cache-control', 'private, max-age=86400')
    return response.download(path)
  }
}
