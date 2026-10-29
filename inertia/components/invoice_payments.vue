<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import { formatMoney, t, todayIso } from '~/i18n'
import { formatDate } from '@shared/dates'

/**
 * An issued Invoice's Payments (or a Legacy Invoice's): its payment
 * status, the Payments and refunds recorded, and the form to record
 * another (ADR 0014).
 */
defineProps<{
  invoiceId: number
  payments: { id: number; amount: string; paidOn: string; note: string | null }[]
  // owed is below zero when overpaid, by overpaidBy
  summary: {
    status: string
    credited: string
    paid: string
    owed: string
    overpaidBy: string | null
  }
}>()

const confirmRemovePayment = () => window.confirm(t('ui.invoices.removePaymentConfirm'))
const today = todayIso()
</script>

<template>
  <Section :title="t('ui.invoices.paymentsTitle')">
    <p v-if="Number(summary.credited)">
      {{ t('ui.invoices.credited', { amount: formatMoney(summary.credited) }) }}
    </p>
    <p>
      <span class="tag">{{ t(`ui.invoices.paymentStatuses.${summary.status}`) }}</span>
      <template v-if="summary.overpaidBy">
        {{
          t('ui.invoices.overpaidBy', {
            paid: formatMoney(summary.paid),
            amount: formatMoney(summary.overpaidBy),
          })
        }}
      </template>
      <template v-else>
        {{
          t('ui.invoices.paidOf', {
            paid: formatMoney(summary.paid),
            owed: formatMoney(summary.owed),
          })
        }}
      </template>
    </p>
    <table v-if="payments.length" class="table">
      <tbody>
        <tr v-for="payment in payments" :key="payment.id">
          <td>{{ formatDate(payment.paidOn) }}</td>
          <td :style="{ textAlign: 'right' }">{{ formatMoney(payment.amount) }}</td>
          <td>{{ payment.note }}</td>
          <td class="table__actions">
            <Form
              route="invoices.remove_payment"
              :params="{ paymentId: payment.id }"
              :on-before="confirmRemovePayment"
            >
              <button type="submit" class="btn btn--ghost btn--sm">
                {{ t('ui.invoices.removePayment') }}
              </button>
            </Form>
          </td>
        </tr>
      </tbody>
    </table>
    <Form
      v-slot="{ processing: paying, errors: paymentErrors }"
      route="invoices.record_payment"
      :params="{ id: invoiceId }"
      reset-on-success
      :style="{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }"
    >
      <div class="field">
        <label class="field__label" for="payment-amount">{{ t('ui.invoices.amountPaid') }}</label>
        <input id="payment-amount" name="amount" inputmode="decimal" class="field__input" />
        <span class="field__hint">{{ t('ui.invoices.refundHint') }}</span>
        <span v-if="paymentErrors.amount" class="field__error">{{ paymentErrors.amount }}</span>
      </div>
      <div class="field">
        <label class="field__label" for="payment-date">{{ t('ui.invoices.paidOn') }}</label>
        <input id="payment-date" name="paidOn" type="date" class="field__input" :value="today" />
        <span v-if="paymentErrors.paidOn" class="field__error">{{ paymentErrors.paidOn }}</span>
      </div>
      <div class="field">
        <label class="field__label" for="payment-note">{{ t('ui.invoices.paymentNote') }}</label>
        <input id="payment-note" name="note" class="field__input" />
      </div>
      <button type="submit" class="btn btn--secondary btn--sm" :disabled="paying">
        {{ t('ui.invoices.recordPayment') }}
      </button>
    </Form>
  </Section>
</template>
