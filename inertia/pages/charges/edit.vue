<script setup lang="ts">
import { computed, ref } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import { amountForInput } from '@shared/money'
import { isHeld, type ChargeEventKind, type ChargeKind, type ChargeState } from '@shared/charges'
import { LINE_KINDS, type LineKind } from '@shared/vat'
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
    billing: {
      quantity: string
      unitPrice: string
      description: string
      unit: string | null
      vatKind: LineKind | null
    }
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
      invoice: { id: number; number: string | null } | null
      amount: string | null
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

// What is billed is frozen while an Invoice holds or bills the Charge
const frozen = computed(() => isHeld(props.charge.state) || props.job.cancelled)
const confirmSetBack = () =>
  window.confirm(
    t('ui.charges.setBackToBillConfirm', { number: props.charge.invoice?.number ?? '' })
  )

const quantity = (value: string) => amountForInput(value)
const shown = (key: string, value: string | null) => {
  if (value === null) return '—'
  if (key === 'unitPrice') return formatMoney(value)
  if (key === 'quantity') return amountForInput(value)
  if (key === 'vatKind') return t(`ui.charges.vatKinds.${value}`)
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
          <div v-else-if="charge.kind === 'item'" class="field">
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
              {{ t('ui.charges.quantity') }}
              {{
                charge.kind === 'labour' ? '(h)' : charge.kind === 'item' ? `(${item?.unit})` : ''
              }}
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
          <fieldset :disabled="frozen" :style="{ border: 0, padding: 0 }">
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
                {{ t('ui.charges.quantity') }}
                {{ charge.billing.unit ? `(${charge.billing.unit})` : '' }}
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
            <template v-if="charge.kind === 'other'">
              <div class="field">
                <label class="field__label" for="billing-unit">{{ t('ui.charges.unit') }}</label>
                <input
                  id="billing-unit"
                  name="unit"
                  class="field__input"
                  :value="charge.billing.unit ?? ''"
                />
                <span v-if="errors.unit" class="field__error">{{ errors.unit }}</span>
              </div>
              <div class="field">
                <label class="field__label" for="billing-vat">{{ t('ui.charges.vatKind') }}</label>
                <select
                  id="billing-vat"
                  name="vatKind"
                  class="field__input"
                  :value="charge.billing.vatKind"
                >
                  <option v-for="kind in LINE_KINDS" :key="kind" :value="kind">
                    {{ t(`ui.charges.vatKinds.${kind}`) }}
                  </option>
                </select>
              </div>
            </template>
            <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
              {{ t('ui.charges.saveBilling') }}
            </button>
          </fieldset>
        </Form>
        <Form
          v-if="charge.state === 'billed' && !job.cancelled"
          route="charges.set_back_to_bill"
          :params="{ id: charge.id }"
          :on-before="confirmSetBack"
        >
          <button type="submit" class="btn btn--ghost btn--sm">
            {{ t('ui.charges.setBackToBill') }}
          </button>
        </Form>
        <template v-if="!frozen">
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
                <Link
                  v-if="event.invoice"
                  route="invoices.edit"
                  :params="{ id: event.invoice.id }"
                  class="il"
                >
                  {{
                    event.amount
                      ? t('ui.charges.billedIn', {
                          number: event.invoice.number ?? '',
                          amount: formatMoney(event.amount),
                        })
                      : t('ui.charges.unbilledFrom', { number: event.invoice.number ?? '' })
                  }}
                </Link>
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
