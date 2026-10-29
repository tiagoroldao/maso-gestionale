import app from '@adonisjs/core/services/app'
import { defineConfig, formatters, loaders } from '@adonisjs/i18n'

/**
 * The interface is Italian (ADR 0006). Translations live in
 * resources/lang/<locale>/*.json as ICU messages, and the Vue pages read
 * the same files.
 */
const i18nConfig = defineConfig({
  defaultLocale: 'it',
  supportedLocales: ['it'],
  formatter: formatters.icu(),

  /**
   * Under test a missing key throws rather than rendering a placeholder:
   * a test comparing against the catalogue would get the same placeholder
   * on both sides and pass (#207).
   */
  fallback: app.inTest
    ? (identifier, locale) => {
        throw new Error(`Missing translation: ${locale}, ${identifier}`)
      }
    : undefined,

  loaders: [
    loaders.fs({
      location: app.languageFilesPath(),
    }),
  ],
})

export default i18nConfig
