<script setup lang="ts">
import { ref } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import { amountForInput } from '@shared/money'
import type { ChargeEventKind, ChargeKind, ChargeState } from '@shared/charges'
import { formatDate, formatMoney, t } from '~/i18n'

const props = defineProps<{
  charge: {
    id: number
    kind: ChargeKind
    state: ChargeState
    visitStartsAt: string | null
    recorded: {
      quantity: string
      labourRateId: number | null
      technicianId: number | null
      workerName: string | null
      item: { id: number; code: string; description: string; unit: string } | null
    }
    billing: { quantity: string; unitPrice: string; description: string; unit: string }
    invoice: { id: number; number: string | null } | null
    history: {
      id: number
      kind: ChargeEventKind
      at: string
      user: string | null
      changes: {
        before: Record<string, string | null>
        after: Record<string, string | null>
      } | null
    }[]
  }
  job: { id: number; number: string; title: string; cancelled: boolean }
  labourRates: { id: number; name: string }[]
  technicians: { id: number; name: string }[]
}>()

// Hours by someone outside the app, named instead of picked
const someoneElse = ref(props.charge.kind === 'labour' && !props.charge.recorded.technicianId)
const item = ref(props.charge.recorded.item)
const changingItem = ref(false)

function pickItem(picked: PickedItem) {
  item.value = picked
  changingItem.value = false
}

const quantity = (value: string) => amountForInput(value)
const shown = (key: string, value: string | null) => {
  if (value === null) return '—'
  if (key === 'unitPrice') return formatMoney(value)
  if (key === 'quantity') return amountForInput(value)
  return value
}
</script>

<template>
  <AppLayout>
    <Page
      :title="t('ui.charges.editTitle', { number: job.number })"
      :description="
        charge.visitStartsAt
          ? t('ui.charges.visit', { date: formatDate(charge.visitStartsAt) })
          : t('ui.charges.onJob')
      "
    >
      <template #actions>
        <Link route="jobs.show" :params="{ id: job.id }" class="btn btn--ghost btn--sm">
          {{ job.number }} · {{ job.title }}
        </Link>
      </template>

      <p>
        <span class="tag" data-testid="charge-state">{{
          t(`ui.charges.states.${charge.state}`)
        }}</span>
        <Link
          v-if="charge.invoice"
          route="invoices.edit"
          :params="{ id: charge.invoice.id }"
          class="il"
        >
          {{
            charge.invoice.number
              ? t('ui.charges.inInvoice', { number: charge.invoice.number })
              : t('ui.charges.inDraft')
          }}
        </Link>
      </p>

      <Section :title="t('ui.charges.recordedSection')" :description="t('ui.charges.recordedHint')">
        <Form
          v-slot="{ processing, errors }"
          route="charges.correct"
          :params="{ id: charge.id }"
          class="form"
        >
          <template v-if="charge.kind === 'labour'">
            <div class="field">
              <label class="field__label" for="correct-rate">{{
                t('ui.charges.labourRate')
              }}</label>
              <select
                id="correct-rate"
                name="labourRateId"
                class="field__input"
                :value="charge.recorded.labourRateId"
              >
                <option v-for="rate in labourRates" :key="rate.id" :value="rate.id">
                  {{ rate.name }}
                </option>
              </select>
              <span v-if="errors.labourRateId" class="field__error">{{ errors.labourRateId }}</span>
            </div>
            <div class="field">
              <label class="field__label" for="correct-worker">{{ t('ui.charges.worker') }}</label>
              <select
                id="correct-worker"
                :name="someoneElse ? undefined : 'technicianId'"
                class="field__input"
                :value="charge.recorded.technicianId ?? ''"
                @change="someoneElse = ($event.target as HTMLSelectElement).value === ''"
              >
                <option v-for="user in technicians" :key="user.id" :value="user.id">
                  {{ user.name }}
                </option>
                <option value="">{{ t('ui.charges.someoneElse') }}</option>
              </select>
              <span v-if="errors.technicianId" class="field__error">{{ errors.technicianId }}</span>
            </div>
            <div v-if="someoneElse" class="field">
              <label class="field__label" for="correct-worker-name">{{
                t('ui.charges.workerName')
              }}</label>
              <input
                id="correct-worker-name"
                name="workerName"
                class="field__input"
                :value="charge.recorded.workerName ?? ''"
              />
              <span v-if="errors.workerName" class="field__error">{{ errors.workerName }}</span>
            </div>
          </template>
          <div v-else class="field">
            <span class="field__label">{{ t('ui.charges.item') }}</span>
            <input type="hidden" name="itemId" :value="item?.id" />
            <p v-if="item" :style="{ margin: 0 }">
              <span class="mono">{{ item.code }}</span> {{ item.description }}
              <button
                v-if="!changingItem"
                type="button"
                class="btn btn--ghost btn--sm"
                @click="changingItem = true"
              >
                {{ t('ui.charges.changeItem') }}
              </button>
            </p>
            <ItemPicker v-if="changingItem" :label="t('ui.charges.item')" @select="pickItem" />
            <span v-if="errors.itemId" class="field__error">{{ errors.itemId }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="correct-quantity">
              {{ t('ui.charges.quantity') }} ({{ charge.kind === 'labour' ? 'h' : item?.unit }})
            </label>
            <input
              id="correct-quantity"
              name="quantity"
              inputmode="decimal"
              class="field__input"
              :value="quantity(charge.recorded.quantity)"
            />
            <span v-if="errors.quantity" class="field__error">{{ errors.quantity }}</span>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
            {{ t('ui.charges.saveCorrection') }}
          </button>
        </Form>
      </Section>

      <Section :title="t('ui.charges.billingSection')" :description="t('ui.charges.billingHint')">
        <Form
          v-slot="{ processing, errors }"
          route="charges.update_billing"
          :params="{ id: charge.id }"
          class="form"
        >
          <fieldset
            :disabled="charge.invoice !== null || job.cancelled"
            :style="{ border: 0, padding: 0 }"
          >
            <div class="field">
              <label class="field__label" for="billing-description">{{
                t('ui.charges.description')
              }}</label>
              <input
                id="billing-description"
                name="description"
                class="field__input"
                :value="charge.billing.description"
              />
              <span v-if="errors.description" class="field__error">{{ errors.description }}</span>
            </div>
            <div class="field">
              <label class="field__label" for="billing-quantity">
                {{ t('ui.charges.quantity') }} ({{ charge.billing.unit }})
              </label>
              <input
                id="billing-quantity"
                name="quantity"
                inputmode="decimal"
                class="field__input"
                :value="quantity(charge.billing.quantity)"
              />
              <span v-if="errors.quantity" class="field__error">{{ errors.quantity }}</span>
            </div>
            <div class="field">
              <label class="field__label" for="billing-price">{{
                t('ui.charges.unitPrice')
              }}</label>
              <input
                id="billing-price"
                name="unitPrice"
                inputmode="decimal"
                class="field__input"
                :value="amountForInput(charge.billing.unitPrice)"
              />
              <span v-if="errors.unitPrice" class="field__error">{{ errors.unitPrice }}</span>
            </div>
            <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
              {{ t('ui.charges.saveBilling') }}
            </button>
          </fieldset>
        </Form>
        <template v-if="charge.invoice === null && !job.cancelled">
          <Form
            v-if="charge.state === 'not_billable'"
            route="charges.mark_billable"
            :params="{ id: charge.id }"
          >
            <button type="submit" class="btn btn--ghost btn--sm">
              {{ t('ui.charges.markBillable') }}
            </button>
          </Form>
          <Form v-else route="charges.mark_not_billable" :params="{ id: charge.id }">
            <button type="submit" class="btn btn--ghost btn--sm">
              {{ t('ui.charges.markNotBillable') }}
            </button>
          </Form>
        </template>
      </Section>

      <Section :title="t('ui.charges.history')">
        <table class="table" data-testid="charge-history">
          <tbody>
            <tr v-for="event in charge.history" :key="event.id">
              <td>{{ formatDate(event.at) }} {{ event.at.slice(11, 16) }}</td>
              <td>{{ t(`ui.charges.events.${event.kind}`) }}</td>
              <td>{{ event.user ?? '' }}</td>
              <td>
                <div v-for="(after, key) in event.changes?.after ?? {}" :key="key">
                  {{
                    t('ui.charges.change', {
                      field: t(`ui.charges.fields.${key}`),
                      before: shown(String(key), event.changes!.before[key]),
                      after: shown(String(key), after),
                    })
                  }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>
    </Page>
  </AppLayout>
</template>
