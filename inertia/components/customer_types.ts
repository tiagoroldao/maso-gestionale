import { t } from '~/i18n'

export const CUSTOMER_TYPES = ['private', 'company', 'condominium', 'organisation'] as const

export function customerTypeLabel(type: string) {
  return t(`ui.customers.types.${type}`)
}
