import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'

/** What the Item page's actions depend on, worked out by its controller */
export type ItemActionState = {
  item: { id: number; code: string; archived: boolean }
  /** Used somewhere (stock, Charges, Quotes, equipment): archived, never deleted */
  referenced: boolean
}

/**
 * The Item page's actions (docs/ui.md "Actions"): recording goods received
 * is the primary, an adjustment and editing the secondary, archiving and
 * deleting in "⋯". Receipts and adjustments are the page's own short forms
 * (`dialog`). Deleting, a DELETE, is offered only for an Item never used.
 */
export function itemActions({ item, referenced }: ItemActionState, i18n: I18n) {
  const params = { id: item.id }
  const actions: ScreenActionInput[] = [
    { name: 'receive', label: i18n.t('ui.items.receive'), rank: 'primary', kind: 'dialog' },
    { name: 'adjust', label: i18n.t('ui.items.adjust'), rank: 'secondary', kind: 'dialog' },
    {
      name: 'edit',
      label: i18n.t('ui.common.edit'),
      rank: 'secondary',
      kind: 'link',
      href: urlFor('items.edit', params),
    },
  ]
  if (item.archived) {
    actions.push({
      name: 'unarchive',
      label: i18n.t('ui.items.unarchive'),
      rank: 'overflow',
      kind: 'post',
      href: urlFor('items.unarchive', params),
    })
  } else {
    actions.push({
      name: 'archive',
      label: i18n.t('ui.items.archive'),
      rank: 'overflow',
      kind: 'post',
      href: urlFor('items.archive', params),
      destructive: true,
      confirm: i18n.t('ui.items.archiveConfirm', { code: item.code }),
    })
  }
  if (!referenced) {
    actions.push({
      name: 'delete',
      label: i18n.t('ui.items.delete'),
      rank: 'overflow',
      kind: 'post',
      method: 'delete',
      href: urlFor('items.destroy', params),
      destructive: true,
      confirm: i18n.t('ui.items.deleteConfirm'),
    })
  }
  return declareActions(actions)
}
