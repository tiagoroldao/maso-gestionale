import adonis from '@adonisjs/prettier-config'

/**
 * AdonisJS's style, plus Tailwind class order (ADR 0020). ESLint runs
 * Prettier (`prettier/prettier`), so `npm run lint` and CI fail on
 * unordered classes; `npm run format` fixes them. The Tailwind plugin
 * must come last.
 */
export default {
  ...adonis,
  plugins: [...adonis.plugins, 'prettier-plugin-tailwindcss'],
  tailwindStylesheet: './inertia/css/main.css',
  // Class strings built in scripts: `cn(...)` calls
  tailwindFunctions: ['cn'],
}
