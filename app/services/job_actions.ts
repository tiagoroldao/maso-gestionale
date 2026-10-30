import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { formatDate } from '#shared/dates'
import { takesNewWork, type JobStatus } from '#shared/jobs'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'
import { isOpenVisit } from '#shared/visits'

/** What the Job page's actions depend on, worked out by its controller */
export type JobActionState = {
  job: { id: number; number: string; status: JobStatus }
  /** Some work is billable and no draft Invoice from the Charges waits */
  canInvoice: boolean
  /** A draft Invoice from the Charges already waits */
  draftWaiting: boolean
  /** A new Quote may be written (Quotes.canWrite) */
  canWriteQuote: boolean
  visits: { startsAt: string; endsAt: string; status: string }[]
  /** What the user's role allows beyond the Job itself */
  can: { invoices: boolean }
}

/**
 * The Job page's actions (docs/ui.md "Actions"): drafting the Invoice from
 * the Charges is the primary, planning a Visit (or reopening a closed Job)
 * the secondary, the rest in "⋯". Only what the role and the Job's status
 * allow is sent; the draft stays, disabled with its reason, when nothing
 * is to bill, since Office looks for it there.
 */
export function jobActions(state: JobActionState, i18n: I18n) {
  const { job } = state
  const active = takesNewWork(job.status)
  const params = { id: job.id }
  const actions: ScreenActionInput[] = []

  if (state.can.invoices) {
    actions.push({
      name: 'draftInvoice',
      label: i18n.t('ui.invoices.fromCharges'),
      rank: 'primary',
      kind: 'dialog',
      disabledReason: state.canInvoice
        ? null
        : i18n.t(state.draftWaiting ? 'ui.jobs.draftWaiting' : 'ui.jobs.nothingToBill'),
    })
  }
  if (active) {
    actions.push({
      name: 'planVisit',
      label: i18n.t('ui.visits.plan'),
      rank: 'secondary',
      kind: 'link',
      href: urlFor('visits.create', params),
    })
  }
  if (job.status === 'closed') {
    actions.push({
      name: 'reopen',
      label: i18n.t('ui.jobs.reopen'),
      rank: 'secondary',
      kind: 'post',
      href: urlFor('jobs.reopen', params),
    })
  }
  if (job.status !== 'cancelled') {
    actions.push({
      name: 'edit',
      label: i18n.t('ui.common.edit'),
      rank: 'overflow',
      kind: 'link',
      href: urlFor('jobs.edit', params),
    })
  }
  // A Job may have several Quotes (ADR 0013), written when Quotes.canWrite says
  if (state.canWriteQuote) {
    actions.push({
      name: 'newQuote',
      label: i18n.t('ui.quotes.new'),
      rank: 'overflow',
      kind: 'link',
      href: urlFor('quotes.create', params),
    })
  }
  if (state.can.invoices) {
    // An advance is for work to come
    if (active) {
      actions.push({
        name: 'newAdvance',
        label: i18n.t('ui.invoices.newAdvance'),
        rank: 'overflow',
        kind: 'post',
        href: urlFor('invoices.store_advance', params),
      })
    }
    actions.push({
      name: 'newLegacyInvoice',
      label: i18n.t('ui.legacyInvoices.new'),
      rank: 'overflow',
      kind: 'link',
      href: urlFor('legacy_invoices.create', undefined, { qs: { jobId: job.id } }),
    })
  }
  if (active) {
    // Closing shows what it leaves behind first (ADR 0015): the page's dialog
    actions.push({
      name: 'close',
      label: i18n.t('ui.jobs.close'),
      rank: 'overflow',
      kind: 'dialog',
    })
    actions.push({
      name: 'cancel',
      label: i18n.t('ui.jobs.cancel'),
      rank: 'overflow',
      kind: 'post',
      href: urlFor('jobs.cancel', params),
      destructive: true,
      confirm: cancelQuestion(state, i18n),
    })
  }
  return declareActions(actions)
}

/** Cancelling leaves open Visits frozen until Office marks them done (#153): name them */
function cancelQuestion({ job, visits }: JobActionState, i18n: I18n) {
  const open = visits.filter((visit) => isOpenVisit(visit.status))
  if (!open.length) return i18n.t('ui.jobs.cancelConfirm', { number: job.number })
  return i18n.t('ui.jobs.cancelConfirmOpenVisits', {
    number: job.number,
    visits: open
      .map(
        (visit) =>
          `• ${formatDate(visit.startsAt)} ${visit.startsAt.slice(11, 16)}–${visit.endsAt.slice(11, 16)} (${i18n.t(`ui.visits.statuses.${visit.status}`)})`
      )
      .join('\n'),
  })
}
