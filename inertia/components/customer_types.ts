import { t } from '~/i18n'

export const CUSTOMER_TYPES = ['private', 'company', 'condominium'] as const

export function customerTypeLabel(type: string) {
  return t(`ui.customers.types.${type}`)
}
