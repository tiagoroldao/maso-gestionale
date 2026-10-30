/**
 * The widths screens are checked at (docs/ui.md "Screen sizes"): one per
 * screen size, used by `npm run ui:shots` and by the browser tests that
 * check a rule at a screen size. Heights are a typical device's.
 */
export const SCREEN_SIZES = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
} as const

export type ScreenSize = keyof typeof SCREEN_SIZES
