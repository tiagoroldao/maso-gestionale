import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'
import { archiveActions, callHref } from '#services/contact_actions'

/** What the Customer page's actions depend on, worked out by its controller */
export type CustomerActionState = {
  customer: { id: number; phone: string | null; archived: boolean }
  /** What the user's role allows beyond the Customer itself */
  can: { jobs: boolean }
}

/**
 * The Customer page's actions (docs/ui.md "Actions"): a new Job for the
 * Customer is the primary, editing and calling the secondary, archiving
 * (confirmed) in "⋯". An archived Customer takes no new Job, and offers
 * restoring instead. Adding a Site, an Invoice or a document sits in its
 * section.
 */
export function customerActions(state: CustomerActionState, i18n: I18n) {
  const { customer } = state
  const params = { id: customer.id }
  const actions: ScreenActionInput[] = []

  if (state.can.jobs && !customer.archived) {
    actions.push({
      name: 'newJob',
      label: i18n.t('ui.jobs.newForCustomer'),
      rank: 'primary',
      kind: 'link',
      href: urlFor('jobs.create', undefined, { qs: { customerId: customer.id } }),
    })
  }
  actions.push({
    name: 'edit',
    label: i18n.t('ui.common.edit'),
    rank: 'secondary',
    kind: 'link',
    href: urlFor('customers.edit', params),
  })
  if (customer.phone) {
    actions.push({
      name: 'call',
      label: i18n.t('ui.screen.call'),
      rank: 'secondary',
      kind: 'link',
      href: callHref(customer.phone),
    })
  }
  actions.push(
    ...archiveActions(customer.archived, {
      archive: urlFor('customers.archive', params),
      restore: urlFor('customers.restore', params),
      i18n,
    })
  )
  return declareActions(actions)
}
