import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { formatMoney } from '#shared/money'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'

/** The page's form Save submits */
export const QUOTE_FORM = 'quote-form'

/** What the Quote screen's actions depend on, worked out by its controller */
export type QuoteActionState = {
  /** Null while writing a new Quote, before its first save */
  quote: { id: number; number: string; total: string } | null
  /** Quotes.isEditable: a draft on a Job that takes new work */
  editable: boolean
  /** Quotes.isSendable */
  sendable: boolean
  /** Quotes.isDecidable */
  decidable: boolean
}

/**
 * The Quote screen's actions (docs/ui.md "Actions"). While it is a draft
 * the screen is in edit mode: Save is the primary, marking it sent and the
 * PDF beside it, the Customer's answer in "⋯". Once sent, the answer the
 * Customer gave is the primary (accepted), declined in "⋯". The PDF stays
 * on every saved Quote. Sending and the answers freeze the Quote, so each
 * asks first.
 */
export function quoteActions(state: QuoteActionState, i18n: I18n) {
  const { quote } = state
  const actions: ScreenActionInput[] = []

  if (state.editable) {
    actions.push({
      name: 'save',
      label: i18n.t('ui.quotes.save'),
      rank: 'primary',
      kind: 'submit',
      form: QUOTE_FORM,
    })
  }
  if (!quote) return declareActions(actions)
  const params = { id: quote.id }

  if (state.sendable) {
    actions.push({
      name: 'send',
      label: i18n.t('ui.quotes.send'),
      rank: 'secondary',
      kind: 'post',
      href: urlFor('quotes.send', params),
      confirm: i18n.t('ui.quotes.sendConfirm'),
    })
  }
  // A file, not a page: shown in a new tab
  actions.push({
    name: 'pdf',
    label: i18n.t('ui.quotes.pdf'),
    rank: 'secondary',
    kind: 'link',
    href: urlFor('quotes.pdf', params),
    file: 'view',
  })
  if (state.decidable) {
    actions.push({
      name: 'accept',
      label: i18n.t('ui.quotes.accept'),
      rank: state.editable ? 'overflow' : 'primary',
      kind: 'post',
      href: urlFor('quotes.accept', params),
      confirm: i18n.t('ui.quotes.acceptConfirm', { total: formatMoney(quote.total) }),
    })
    actions.push({
      name: 'decline',
      label: i18n.t('ui.quotes.decline'),
      rank: 'overflow',
      kind: 'post',
      href: urlFor('quotes.decline', params),
      confirm: i18n.t('ui.quotes.declineConfirm', { number: quote.number }),
    })
  }
  return declareActions(actions)
}
