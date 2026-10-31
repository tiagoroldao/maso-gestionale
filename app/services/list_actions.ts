import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'

type ListLink = { name: string; label: string; href: string }

/**
 * A List screen's actions (docs/ui.md "Lists"): creating a record
 * ("Nuovo …") is the primary; the list's other pages (the archived
 * records, a Legacy Invoice, the Suppliers) are secondary links.
 */
export function listActions(create: Omit<ListLink, 'name'> | null, secondary: ListLink[] = []) {
  const actions: ScreenActionInput[] = secondary.map((link) => ({
    ...link,
    rank: 'secondary',
    kind: 'link',
  }))
  if (create) actions.push({ name: 'new', ...create, rank: 'primary', kind: 'link' })
  return declareActions(actions)
}

/**
 * The link between a list's active records and its archived ones, labelled
 * with where it goes
 */
export function archivedLink(
  route: 'customers.index' | 'sites.index' | 'items.index',
  archived: boolean,
  i18n: I18n,
  labels = { show: 'ui.archive.showArchived', hide: 'ui.archive.hideArchived' }
): ListLink {
  return {
    name: 'archived',
    label: i18n.t(archived ? labels.hide : labels.show),
    href: urlFor(route, undefined, { qs: archived ? {} : { archived: 'true' } }),
  }
}
