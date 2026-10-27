import i18nManager from '@adonisjs/i18n/services/main'

/**
 * The Italian message for `key`, so tests assert what users see without
 * repeating the catalogue's wording.
 */
export function it(key: string, data?: Record<string, unknown>) {
  return i18nManager.locale('it').t(key, data)
}

export const ACCESS_DENIED_KEY = 'errors.E_AUTHORIZATION_FAILURE'
