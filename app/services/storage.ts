import { join } from 'node:path'
import env from '#start/env'
import app from '@adonisjs/core/services/app'

/**
 * Absolute path inside the Instance's file storage: uploaded files that
 * must survive restarts and be included in backups. Defaults to
 * `storage/` in the app directory.
 */
export function storagePath(...segments: string[]) {
  const root = env.get('STORAGE_PATH') ?? app.makePath('storage')
  return join(root, ...segments)
}
