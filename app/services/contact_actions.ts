import type { I18n } from '@adonisjs/i18n'
import type { ScreenActionInput } from '#shared/screen_actions'

/** A phone number as a `tel:` link: digits and a leading "+" only */
export function callHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

/** An address searched on the map app, on the phone or the web */
export function mapHref(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

/**
 * Archiving a record others refer to (a Customer, a Site): confirmed, in
 * "⋯"; an archived one offers restoring instead, unconfirmed.
 */
export function archiveActions(
  archived: boolean,
  { archive, restore, i18n }: { archive: string; restore: string; i18n: I18n }
): ScreenActionInput[] {
  if (archived) {
    return [
      {
        name: 'restore',
        label: i18n.t('ui.archive.restore'),
        rank: 'secondary',
        kind: 'post',
        href: restore,
      },
    ]
  }
  return [
    {
      name: 'archive',
      label: i18n.t('ui.archive.archive'),
      rank: 'overflow',
      kind: 'post',
      href: archive,
      destructive: true,
      confirm: i18n.t('ui.archive.confirm'),
    },
  ]
}
