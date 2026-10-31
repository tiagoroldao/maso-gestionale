<script setup lang="ts">
/**
 * An issued Invoice's Payments (or a Legacy Invoice's), a section of its
 * screen: its payment status, the Payments and refunds recorded, each
 * removed from its row after a confirmation, and recording another from
 * the section's action, in a dialog (ADR 0014, docs/ui.md "Actions").
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Form } from '@adonisjs/inertia/vue'
import { Trash2 } from 'lucide-vue-next'
import { formatMoney, t, todayIso } from '~/i18n'
import { urlFor } from '~/client'
import { cn } from '~/lib/utils'
import { formatDate } from '@shared/dates'
import type { PaymentStatus } from '@shared/payment_status'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import FormField from '~/components/screen/form_field.vue'
import ConfirmDialog from '~/components/screen/confirm_dialog.vue'
import { PAYMENT_TONES, ROW, TOUCH } from '~/components/screen/screen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'

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

const recordOpen = ref(false)
const today = todayIso()

// Removing a Payment entered by mistake asks first
const removing = ref<number | null>(null)
const removeOpen = ref(false)
function askRemove(id: number) {
  removing.value = id
  removeOpen.value = true
}
function remove() {
  removeOpen.value = false
  if (removing.value === null) return
  router.delete(urlFor('invoices.remove_payment', { paymentId: removing.value }), {
    preserveScroll: true,
  })
}
</script>

<template>
  <ScreenSection :title="t('ui.invoices.paymentsTitle')" flush>
    <template #actions>
      <Button type="button" variant="outline" :class="TOUCH" @click="recordOpen = true">
        {{ t('ui.invoices.recordPayment') }}
      </Button>
    </template>
    <div class="flex flex-col gap-1.5 px-3.5 pb-3 text-sm md:px-4">
      <p class="m-0 flex flex-wrap items-center gap-2">
        <StatusTag :tone="PAYMENT_TONES[summary.status as PaymentStatus]">
          {{ t(`ui.invoices.paymentStatuses.${summary.status}`) }}
        </StatusTag>
        <span>
          {{
            summary.overpaidBy
              ? t('ui.invoices.overpaidBy', {
                  paid: formatMoney(summary.paid),
                  amount: formatMoney(summary.overpaidBy),
                })
              : t('ui.invoices.paidOf', {
                  paid: formatMoney(summary.paid),
                  owed: formatMoney(summary.owed),
                })
          }}
        </span>
      </p>
      <p v-if="Number(summary.credited)" class="m-0 text-muted-foreground">
        {{ t('ui.invoices.credited', { amount: formatMoney(summary.credited) }) }}
      </p>
    </div>
    <ul v-if="payments.length" class="m-0 list-none p-0" data-testid="payments">
      <li
        v-for="payment in payments"
        :key="payment.id"
        :class="cn(ROW, 'items-center text-sm md:px-4')"
      >
        <span class="whitespace-nowrap">{{ formatDate(payment.paidOn) }}</span>
        <span class="min-w-0 flex-1 text-muted-foreground">{{ payment.note }}</span>
        <span class="font-semibold whitespace-nowrap">{{ formatMoney(payment.amount) }}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          class="md:size-9"
          :aria-label="t('ui.invoices.removePaymentOf', { date: formatDate(payment.paidOn) })"
          @click="askRemove(payment.id)"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </li>
    </ul>
  </ScreenSection>

  <Dialog v-model:open="recordOpen">
    <DialogContent :close-label="t('ui.screen.closeDialog')">
      <DialogTitle>{{ t('ui.invoices.recordPayment') }}</DialogTitle>
      <DialogDescription>{{ t('ui.invoices.refundHint') }}</DialogDescription>
      <Form
        v-slot="{ processing, errors }"
        route="invoices.record_payment"
        :params="{ id: invoiceId }"
        class="flex flex-col gap-4"
        reset-on-success
        @success="recordOpen = false"
      >
        <FormField
          id="payment-amount"
          v-slot="field"
          :label="t('ui.invoices.amountPaid')"
          :error="errors.amount"
        >
          <Input
            :id="field.id"
            name="amount"
            inputmode="decimal"
            :class="TOUCH"
            :aria-invalid="field.invalid"
            :aria-describedby="field.describedBy"
          />
        </FormField>
        <FormField
          id="payment-date"
          v-slot="field"
          :label="t('ui.invoices.paidOn')"
          :error="errors.paidOn"
        >
          <Input
            :id="field.id"
            name="paidOn"
            type="date"
            :default-value="today"
            :class="TOUCH"
            :aria-invalid="field.invalid"
            :aria-describedby="field.describedBy"
          />
        </FormField>
        <FormField id="payment-note" v-slot="field" :label="t('ui.invoices.paymentNote')">
          <Input :id="field.id" name="note" :class="TOUCH" />
        </FormField>
        <DialogFooter>
          <Button type="button" variant="outline" :class="TOUCH" @click="recordOpen = false">
            {{ t('ui.screen.goBack') }}
          </Button>
          <Button type="submit" :class="TOUCH" :disabled="processing">
            {{ t('ui.invoices.recordPayment') }}
          </Button>
        </DialogFooter>
      </Form>
    </DialogContent>
  </Dialog>

  <ConfirmDialog
    v-model:open="removeOpen"
    :title="t('ui.invoices.removePayment')"
    :description="t('ui.invoices.removePaymentConfirm')"
    :confirm-label="t('ui.invoices.removePayment')"
    @confirm="remove"
  />
</template>
