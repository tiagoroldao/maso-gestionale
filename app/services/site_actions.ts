import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { declareActions } from '#shared/screen_actions'
import { archiveActions, mapHref } from '#services/contact_actions'

/** What the Site page's actions depend on, worked out by its controller */
export type SiteActionState = { site: { id: number; address: string; archived: boolean } }

/**
 * The Site page's actions (docs/ui.md "Actions"): editing and the map the
 * secondary, archiving (confirmed) in "⋯", or restoring an archived Site.
 * It has no primary: its Jobs start from a Customer, and adding Installed
 * Equipment sits in its section.
 */
export function siteActions({ site }: SiteActionState, i18n: I18n) {
  const params = { id: site.id }
  return declareActions([
    {
      name: 'edit',
      label: i18n.t('ui.common.edit'),
      rank: 'secondary',
      kind: 'link',
      href: urlFor('sites.edit', params),
    },
    {
      name: 'map',
      label: i18n.t('ui.screen.map'),
      rank: 'secondary',
      kind: 'link',
      href: mapHref(site.address),
    },
    ...archiveActions(site.archived, {
      archive: urlFor('sites.archive', params),
      restore: urlFor('sites.restore', params),
      i18n,
    }),
  ])
}
