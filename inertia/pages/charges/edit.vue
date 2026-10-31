<script setup lang="ts">
/**
 * A Charge, an Entity screen in edit mode under its Job (docs/ui.md, ADR
 * 0010, 0014, 0016): what is billed is the main work, saved by the header's
 * primary, which the server holds with its reason while an Invoice holds,
 * bills or credited the Charge. What was recorded is corrected in its own
 * section, with its own Save; its work state, not billable and setting it
 * back to bill are the header's other actions, sent by the server for the
 * Charge's states. Its history sits beside. Unsaved billing holds back
 * every other action, each of which reloads the page (#283).
 */
import { computed, reactive, ref, watch } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import FormField from '~/components/screen/form_field.vue'
import type { KeyFact } from '~/components/screen/key_facts.vue'
import { CHARGE_TONES, LINK, TOUCH, WORK_TONES } from '~/components/screen/screen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import { urlFor } from '~/client'
import { cn } from '~/lib/utils'
import { amountForInput, lineTotal, parseAmount } from '@shared/money'
import { takesSerialNumber } from '@shared/items'
import {
  isHeld,
  wontBillReason,
  type ChargeEventKind,
  type ChargeKind,
  type ChargeState,
  type WorkState,
} from '@shared/charges'
import type { ScreenAction } from '@shared/screen_actions'
import { LINE_KINDS, type LineKind } from '@shared/vat'
import { formatDate, formatMoney, t } from '~/i18n'

const props = defineProps<{
  // The header's actions, for the Charge's states
  actions: ScreenAction[]
  charge: {
    id: number
    kind: ChargeKind
    state: ChargeState
    workState: WorkState
    canSetWork: boolean
    frozen: boolean
    visitStartsAt: string | null
    recorded: {
      quantity: string
      labourRateId: number | null
      technicianId: number | null
      workerName: string | null
      item: {
        id: number
        code: string
        description: string
        unit: string
        equipment: boolean
      } | null
      equipment: {
        equipmentType: string | null
        make: string | null
        model: string | null
        serialNumber: string | null
      }
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
  job: { id: number; number: string; title: string }
  labourRates: { id: number; name: string }[]
  technicians: { id: number; name: string }[]
}>()

// Save, in the header, waits while the billing is sent
const busy = ref(false)

/**
 * What is billed, as typed: the server's until the user edits it, so
 * unsaved edits can be told apart (as on the Quote and Invoice screens).
 */
const billingFromProps = () => ({
  description: props.charge.billing.description,
  quantity: amountForInput(props.charge.billing.quantity),
  unitPrice: amountForInput(props.charge.billing.unitPrice),
  unit: props.charge.billing.unit ?? '',
  vatKind: props.charge.billing.vatKind ?? undefined,
})
const billing = reactive(billingFromProps())
const saved = ref(JSON.stringify(billingFromProps()))
const dirty = computed(() => JSON.stringify(billing) !== saved.value)
// Saved, or changed by another action: show what the server has
function showSaved() {
  Object.assign(billing, billingFromProps())
  saved.value = JSON.stringify(billingFromProps())
}
watch(() => props.charge.billing, showSaved)

// The header: while billing waits for Save, the other actions (each
// reloads the page) wait too
const screenActions = computed(() =>
  props.actions.map((action) =>
    dirty.value && action.name !== 'saveBilling'
      ? { ...action, disabledReason: t('ui.charges.saveBillingFirst') }
      : action
  )
)

// Hours by someone outside the app, named instead of picked
const someoneElse = ref(props.charge.kind === 'labour' && !props.charge.recorded.technicianId)
const item = ref(props.charge.recorded.item)
const changingItem = ref(false)

function pickItem(picked: PickedItem) {
  item.value = picked
  changingItem.value = false
}

// An Equipment Item's details, until it is done (#169): a serial number
// for a single piece only
const correctedQuantity = ref(amountForInput(props.charge.recorded.quantity))
const pendingDetails = computed(
  () => props.charge.kind === 'item' && !!item.value?.equipment && props.charge.workState !== 'done'
)
const singlePiece = computed(() => {
  const parsed = parseAmount(correctedQuantity.value)
  return parsed !== null && takesSerialNumber(parsed.toFixed())
})

// What is billed is frozen while an Invoice holds or bills the Charge,
// whatever the Job's status (#111)
const frozen = computed(() => isHeld(props.charge.state))

// The header: where the Charge comes from, and the key facts under it
const source = computed(() =>
  props.charge.visitStartsAt
    ? t('ui.charges.visit', { date: formatDate(props.charge.visitStartsAt) })
    : t('ui.charges.onJob')
)
const facts = computed(() => `${t(`ui.charges.kinds.${props.charge.kind}`)} · ${source.value}`)
const recordedUnit = computed(() =>
  props.charge.kind === 'labour'
    ? 'h'
    : props.charge.kind === 'item'
      ? (props.charge.recorded.item?.unit ?? '')
      : (props.charge.billing.unit ?? '')
)
// Why its amount won't be billed, if it won't
const wontBill = computed(() => wontBillReason(props.charge.state, props.charge.workState))
const keyFacts = computed<KeyFact[]>(() => [
  {
    label: t('ui.charges.job'),
    value: props.job.number,
    href: urlFor('jobs.show', { id: props.job.id }),
    hint: props.job.title,
  },
  {
    label: t('ui.charges.recordedSection'),
    value: `${quantity(props.charge.recorded.quantity)} ${recordedUnit.value}`.trim(),
    hint: source.value,
  },
  {
    label: t('ui.charges.amount'),
    value: formatMoney(lineTotal(props.charge.billing.quantity, props.charge.billing.unitPrice)),
    amount: true,
    hint: [
      t('ui.charges.quantityAtPrice', {
        quantity:
          `${quantity(props.charge.billing.quantity)} ${props.charge.billing.unit ?? ''}`.trim(),
        price: formatMoney(props.charge.billing.unitPrice),
      }),
      ...(wontBill.value ? [t(`ui.charges.wontBill.${wontBill.value}`)] : []),
    ].join(' · '),
  },
  {
    label: t('ui.charges.invoice'),
    // The draft holding it, or the Invoice billing it
    value: props.charge.invoice
      ? props.charge.invoice.number
        ? t('ui.charges.inInvoice', { number: props.charge.invoice.number })
        : t('ui.charges.inDraft')
      : t('ui.charges.noInvoice'),
    href: props.charge.invoice
      ? urlFor('invoices.edit', { id: props.charge.invoice.id })
      : undefined,
  },
])

// The Quote's number goes with its line, not on a line of its own
const shownChanges = (changes: { after: Record<string, string | null> } | null) =>
  Object.fromEntries(Object.entries(changes?.after ?? {}).filter(([key]) => key !== 'quote'))
const quantity = (value: string) => amountForInput(value)
const shown = (key: string, value: string | null) => {
  if (value === null) return '—'
  if (key === 'unitPrice') return formatMoney(value)
  if (key === 'quantity') return amountForInput(value)
  if (key === 'vatKind') return t(`ui.charges.vatKinds.${value}`)
  return value
}
const asOption = (id: number | null | undefined) => (id ? String(id) : '')
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="`${charge.billing.description} · ${job.number}`"
      :crumbs="[
        { label: t('ui.jobs.title'), href: urlFor('jobs.index') },
        { label: job.number, href: urlFor('jobs.show', { id: job.id }) },
      ]"
      :current="charge.billing.description"
      :title="charge.billing.description"
      :facts="facts"
      :actions="screenActions"
      :key-facts="keyFacts"
      :busy="busy"
    >
      <template #tags>
        <StatusTag :tone="WORK_TONES[charge.workState]" data-testid="charge-work-state">
          {{ t(`ui.charges.workStates.${charge.workState}`) }}
        </StatusTag>
        <StatusTag :tone="CHARGE_TONES[charge.state]" data-testid="charge-state">
          {{ t(`ui.charges.states.${charge.state}`) }}
        </StatusTag>
      </template>

      <template #main>
        <ScreenSection
          :title="t('ui.charges.billingSection')"
          :description="t('ui.charges.billingHint')"
        >
          <template #actions>
            <span v-if="dirty" role="status" class="text-[13px] text-muted-foreground">
              {{ t('ui.charges.unsaved') }}
            </span>
          </template>
          <!-- Named for the header's Save (charge_actions.ts); an action form,
               since a route form's types take no id -->
          <Form
            id="charge-billing"
            v-slot="{ errors }"
            :action="{ url: urlFor('charges.update_billing', { id: charge.id }), method: 'put' }"
            @start="busy = true"
            @finish="busy = false"
            @success="showSaved"
          >
            <fieldset :disabled="frozen" class="m-0 grid gap-4 border-0 p-0 md:grid-cols-2">
              <FormField
                id="billing-description"
                v-slot="field"
                :label="t('ui.charges.description')"
                :error="errors.description"
                class="md:col-span-2"
              >
                <Input
                  :id="field.id"
                  v-model="billing.description"
                  name="description"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="billing-quantity"
                v-slot="field"
                :label="
                  charge.billing.unit
                    ? `${t('ui.charges.quantity')} (${charge.billing.unit})`
                    : t('ui.charges.quantity')
                "
                :error="errors.quantity"
              >
                <Input
                  :id="field.id"
                  v-model="billing.quantity"
                  name="quantity"
                  inputmode="decimal"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="billing-price"
                v-slot="field"
                :label="t('ui.charges.unitPrice')"
                :error="errors.unitPrice"
              >
                <Input
                  :id="field.id"
                  v-model="billing.unitPrice"
                  name="unitPrice"
                  inputmode="decimal"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <template v-if="charge.kind === 'other'">
                <FormField
                  id="billing-unit"
                  v-slot="field"
                  :label="t('ui.charges.unit')"
                  :error="errors.unit"
                >
                  <Input
                    :id="field.id"
                    v-model="billing.unit"
                    name="unit"
                    :class="TOUCH"
                    :aria-invalid="field.invalid"
                    :aria-describedby="field.describedBy"
                  />
                </FormField>
                <FormField
                  id="billing-vat"
                  v-slot="field"
                  :label="t('ui.charges.vatKind')"
                  :error="errors.vatKind"
                >
                  <NativeSelect
                    :id="field.id"
                    v-model="billing.vatKind"
                    name="vatKind"
                    :aria-invalid="field.invalid"
                    :aria-describedby="field.describedBy"
                  >
                    <option v-for="kind in LINE_KINDS" :key="kind" :value="kind">
                      {{ t(`ui.charges.vatKinds.${kind}`) }}
                    </option>
                  </NativeSelect>
                </FormField>
              </template>
            </fieldset>
          </Form>
        </ScreenSection>

        <ScreenSection
          :title="t('ui.charges.recordedSection')"
          :description="t('ui.charges.recordedHint')"
        >
          <p
            v-if="charge.frozen"
            class="m-0 text-[13px] text-muted-foreground"
            data-testid="charge-frozen"
          >
            {{ t('ui.charges.frozenHint') }}
          </p>
          <Form
            v-slot="{ processing, errors }"
            route="charges.correct"
            :params="{ id: charge.id }"
            class="grid gap-4 md:grid-cols-2"
          >
            <template v-if="charge.kind === 'labour'">
              <FormField
                id="correct-rate"
                v-slot="field"
                :label="t('ui.charges.labourRate')"
                :error="errors.labourRateId"
              >
                <NativeSelect
                  :id="field.id"
                  name="labourRateId"
                  :model-value="asOption(charge.recorded.labourRateId)"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                >
                  <option v-for="rate in labourRates" :key="rate.id" :value="String(rate.id)">
                    {{ rate.name }}
                  </option>
                </NativeSelect>
              </FormField>
              <FormField
                id="correct-worker"
                v-slot="field"
                :label="t('ui.charges.worker')"
                :error="errors.technicianId"
              >
                <NativeSelect
                  :id="field.id"
                  :name="someoneElse ? undefined : 'technicianId'"
                  :model-value="asOption(charge.recorded.technicianId)"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                  @change="someoneElse = ($event.target as HTMLSelectElement).value === ''"
                >
                  <option v-for="user in technicians" :key="user.id" :value="String(user.id)">
                    {{ user.name }}
                  </option>
                  <option value="">{{ t('ui.charges.someoneElse') }}</option>
                </NativeSelect>
              </FormField>
              <FormField
                v-if="someoneElse"
                id="correct-worker-name"
                v-slot="field"
                :label="t('ui.charges.workerName')"
                :error="errors.workerName"
              >
                <Input
                  :id="field.id"
                  name="workerName"
                  :model-value="charge.recorded.workerName ?? ''"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </template>
            <div v-else-if="charge.kind === 'item'" class="flex flex-col gap-1.5 md:col-span-2">
              <span class="text-sm font-medium">{{ t('ui.charges.item') }}</span>
              <input type="hidden" name="itemId" :value="item?.id" />
              <p v-if="item" class="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span>
                  <span class="font-mono text-[13px]">{{ item.code }}</span>
                  {{ item.description }}
                </span>
                <Button
                  v-if="!changingItem"
                  type="button"
                  variant="outline"
                  :class="TOUCH"
                  @click="changingItem = true"
                >
                  {{ t('ui.charges.changeItem') }}
                </Button>
              </p>
              <ItemPicker v-if="changingItem" :label="t('ui.charges.item')" @select="pickItem" />
              <p v-if="errors.itemId" class="m-0 flex items-start gap-1.5 text-sm text-destructive">
                <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
                {{ errors.itemId }}
              </p>
            </div>
            <FormField
              id="correct-quantity"
              v-slot="field"
              :label="
                charge.kind === 'labour'
                  ? `${t('ui.charges.quantity')} (h)`
                  : charge.kind === 'item'
                    ? `${t('ui.charges.quantity')} (${item?.unit ?? ''})`
                    : t('ui.charges.quantity')
              "
              :error="errors.quantity"
            >
              <Input
                :id="field.id"
                v-model="correctedQuantity"
                name="quantity"
                inputmode="decimal"
                :class="TOUCH"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
            <template v-if="pendingDetails">
              <p class="m-0 text-[13px] text-muted-foreground md:col-span-2">
                {{ t('ui.charges.equipmentDetails') }}
              </p>
              <FormField
                id="correct-type"
                v-slot="field"
                :label="t('ui.field.equipmentType')"
                :hint="t('ui.field.equipmentTypeHint')"
                :error="errors.equipmentType"
              >
                <Input
                  :id="field.id"
                  name="equipmentType"
                  :model-value="charge.recorded.equipment.equipmentType ?? ''"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="correct-make"
                v-slot="field"
                :label="t('ui.field.make')"
                :error="errors.make"
              >
                <Input
                  :id="field.id"
                  name="make"
                  :model-value="charge.recorded.equipment.make ?? ''"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="correct-model"
                v-slot="field"
                :label="t('ui.field.model')"
                :error="errors.model"
              >
                <Input
                  :id="field.id"
                  name="model"
                  :model-value="charge.recorded.equipment.model ?? ''"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                v-if="singlePiece"
                id="correct-serial"
                v-slot="field"
                :label="t('ui.field.serialNumber')"
                :error="errors.serialNumber"
              >
                <Input
                  :id="field.id"
                  name="serialNumber"
                  :model-value="charge.recorded.equipment.serialNumber ?? ''"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <p v-else class="m-0 self-end text-[13px] text-muted-foreground">
                {{ t('ui.field.serialNumberHint') }}
              </p>
            </template>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 md:col-span-2">
              <Button
                type="submit"
                variant="outline"
                :class="TOUCH"
                :disabled="processing || dirty"
                :aria-describedby="dirty ? 'correction-held' : undefined"
              >
                {{ t('ui.charges.saveCorrection') }}
              </Button>
              <!-- Sending it reloads the page: billing edits first -->
              <span v-if="dirty" id="correction-held" class="text-[13px] text-muted-foreground">
                {{ t('ui.charges.saveBillingFirst') }}
              </span>
            </div>
          </Form>
        </ScreenSection>
      </template>

      <template #side>
        <ScreenSection :title="t('ui.charges.work')">
          <p class="m-0 text-[13px] text-muted-foreground">{{ t('ui.charges.workHint') }}</p>
        </ScreenSection>

        <ScreenSection :title="t('ui.charges.history')" flush>
          <ol class="m-0 list-none p-0" data-testid="charge-history">
            <li
              v-for="event in charge.history"
              :key="event.id"
              class="flex flex-col gap-0.5 border-t border-border px-3.5 py-2.5 text-sm md:px-4"
            >
              <span class="flex flex-wrap items-baseline justify-between gap-x-3">
                <span class="font-semibold">{{ t(`ui.charges.events.${event.kind}`) }}</span>
                <span class="text-[13px] text-muted-foreground">
                  {{ formatDate(event.at) }} {{ event.at.slice(11, 16) }}
                </span>
              </span>
              <span v-if="event.user" class="text-[13px] text-muted-foreground">
                {{ event.user }}
              </span>
              <Link
                v-if="event.invoice"
                :href="urlFor('invoices.edit', { id: event.invoice.id })"
                :class="cn(LINK, 'self-start')"
              >
                {{
                  event.amount
                    ? t('ui.charges.billedIn', {
                        number: event.invoice.number ?? '',
                        amount: formatMoney(event.amount),
                      })
                    : event.kind === 'credited' || event.kind === 'uncredited'
                      ? t('ui.charges.creditedBy', { number: event.invoice.number ?? '' })
                      : t('ui.charges.unbilledFrom', { number: event.invoice.number ?? '' })
                }}
              </Link>
              <span v-for="(after, key) in shownChanges(event.changes)" :key="key">
                <!-- Imported from a Quote line (ADR 0012), of a numbered Quote (ADR 0013) -->
                {{
                  key === 'quoteLine'
                    ? event.changes!.after.quote
                      ? t('ui.charges.fromQuoteLine', {
                          position: after,
                          number: event.changes!.after.quote,
                        })
                      : t('ui.charges.fromUnnumberedQuoteLine', { position: after })
                    : t('ui.charges.change', {
                        field: t(`ui.charges.fields.${key}`),
                        before: shown(String(key), event.changes!.before[key]),
                        after: shown(String(key), after),
                      })
                }}
              </span>
            </li>
          </ol>
        </ScreenSection>
      </template>
    </EntityScreen>
  </AppLayout>
</template>
