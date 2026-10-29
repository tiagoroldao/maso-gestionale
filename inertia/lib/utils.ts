import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Joins class names, later Tailwind classes overriding earlier ones (shadcn-vue's helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
