/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node; dates and "today" are Europe/Rome's, from the process zone (ADR 0006)
  TZ: Env.schema.enum(['Europe/Rome'] as const),
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Database
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  // Files
  STORAGE_PATH: Env.schema.string.optional(),

  // Nightly backup time, HH:mm in Europe/Rome (#33)
  BACKUP_TIME: (key: string, value?: string) => {
    if (!value) return undefined
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${key} must be HH:mm`)
    return value
  },

  // PDF conversion
  GOTENBERG_URL: Env.schema.string({ format: 'url', tld: false }),

  // Openapi's sandbox, only for `node ace sdi:sandbox-check` (docs/openapi-sandbox-check.md)
  OPENAPI_SANDBOX_TOKEN: Env.schema.string.optional(),
})
