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

  loaders: [
    loaders.fs({
      location: app.languageFilesPath(),
    }),
  ],
})

export default i18nConfig
