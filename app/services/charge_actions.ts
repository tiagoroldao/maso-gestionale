import { urlFor } from '@adonisjs/core/services/url_builder'
import type { I18n } from '@adonisjs/i18n'
import { canSetBackToBill, isHeld, type ChargeState, type WorkState } from '#shared/charges'
import { declareActions, type ScreenActionInput } from '#shared/screen_actions'

/** The page's billing form, which Save submits */
export const CHARGE_BILLING_FORM = 'charge-billing'

/** What the Charge screen's actions depend on, worked out by its controller */
export type ChargeActionState = {
  charge: { id: number; state: ChargeState; workState: WorkState }
  /** The Invoice holding or billing it, named in the questions */
  invoiceNumber: string | null
  /**
   * Office may switch done and not done: its Visit closed (or it is on the
   * Job), no draft holds it, no issued billing of it uncredited (ADR 0016)
   */
  canSetWork: boolean
}

/**
 * The Charge screen's actions (docs/ui.md "Actions"), for Admin and Office,
 * the only roles that open it. The screen is in edit mode on what is
 * billed: saving it is the primary, kept disabled with its reason while an
 * Invoice holds, bills or credited the Charge (ADR 0010, 0014). Its work
 * state is switched by the secondary actions, when Office may (ADR 0016);
 * not billable and back, while no Invoice holds it, and setting a billed or
 * credited Charge back to bill, confirmed, in "⋯".
 */
export function chargeActions(state: ChargeActionState, i18n: I18n) {
  const { charge } = state
  const params = { id: charge.id }
  const held = isHeld(charge.state)
  const actions: ScreenActionInput[] = [
    {
      name: 'saveBilling',
      label: i18n.t('ui.charges.saveBilling'),
      rank: 'primary',
      kind: 'submit',
      form: CHARGE_BILLING_FORM,
      disabledReason: held ? i18n.t(`ui.charges.billingHeld.${charge.state}`) : null,
    },
  ]

  if (state.canSetWork && charge.workState !== 'done') {
    actions.push({
      name: 'markDone',
      // Planned on the Job until Office confirms it used
      label: i18n.t(
        charge.workState === 'planned' ? 'ui.charges.confirmUsed' : 'ui.charges.markDone'
      ),
      rank: 'secondary',
      kind: 'post',
      href: urlFor('charges.mark_done', params),
    })
  }
  if (state.canSetWork && charge.workState !== 'not_done') {
    actions.push({
      name: 'markNotDone',
      label: i18n.t('ui.charges.markNotDone'),
      rank: 'secondary',
      kind: 'post',
      href: urlFor('charges.mark_not_done', params),
    })
  }
  if (!held) {
    actions.push(
      charge.state === 'not_billable'
        ? {
            name: 'markBillable',
            label: i18n.t('ui.charges.markBillable'),
            rank: 'overflow',
            kind: 'post',
            href: urlFor('charges.mark_billable', params),
          }
        : {
            name: 'markNotBillable',
            label: i18n.t('ui.charges.markNotBillable'),
            rank: 'overflow',
            kind: 'post',
            href: urlFor('charges.mark_not_billable', params),
          }
    )
  }
  if (canSetBackToBill(charge.state)) {
    actions.push({
      name: 'setBackToBill',
      label: i18n.t('ui.charges.setBackToBill'),
      rank: 'overflow',
      kind: 'post',
      href: urlFor('charges.set_back_to_bill', params),
      destructive: true,
      confirm: i18n.t('ui.charges.setBackToBillConfirm', { number: state.invoiceNumber ?? '' }),
    })
  }
  return declareActions(actions)
}
