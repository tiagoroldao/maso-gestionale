/**
 * The kind of work, which with the Customer type and the Site decides the
 * default VAT on the Job's Invoice lines.
 */
export const WORK_CATEGORIES = [
  'new_installation',
  'maintenance',
  'renovation',
  'repair',
  'sale',
] as const
export type WorkCategory = (typeof WORK_CATEGORIES)[number]
