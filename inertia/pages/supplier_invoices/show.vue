<script setup lang="ts">
/**
 * A Supplier Invoice, an Entity screen on the new UI (docs/ui.md): its
 * header actions (the original file, sending it to legal archiving) come
 * from the server; its lines are the main work, each handled in its row
 * (received into stock, already received, or not stock); the document,
 * its legal archiving and the parties beside them; the VAT summary and the
 * payments full width below.
 *
 * Each line's form runs the shared rules live (the default cost, a newer
 * receipt, units that differ); the server runs them again on submit.
 */
import { computed, reactive, ref, watchEffect } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import { router } from '@inertiajs/vue3'
import { CircleAlert } from 'lucide-vue-next'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import ItemPreview from '~/components/item_preview.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, formatUnitPrice, t, todayIso } from '~/i18n'
import { cn } from '~/lib/utils'
import { formatDateTime } from '@shared/dates'
import { vatLabel } from '@shared/vat'
import { formatQuantity } from '@shared/stock'
import { amountForInput, parseQuantity } from '@shared/money'
import { isSdiFailureCode } from '@shared/sdi_failures'
import type { ScreenAction } from '@shared/screen_actions'
import {
  newerCostExists,
  nextPayment,
  receiptUnitCost,
  unitsDiffer,
  type LineOutcome,
  type LegalArchivingState,
  type LineReceiptRefusal,
  type SupplierInvoiceDetails,
  type SupplierInvoiceStatus,
} from '@shared/supplier_invoices'
import { documentTypeLabel, formatAmount, paymentMethodLabel } from '~/components/supplier_invoices'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import ConfirmDialog from '~/components/screen/confirm_dialog.vue'
import FormField from '~/components/screen/form_field.vue'
import type { KeyFact } from '~/components/screen/key_facts.vue'
import {
  LINK,
  PICKER_ERROR,
  PREVIEW_LINK,
  ROW,
  SUPPLIER_INVOICE_TONES,
  TD,
  TH,
  TOUCH,
} from '~/components/screen/screen'

const props = defineProps<{
  // The header's actions, for the invoice's state
  actions: ScreenAction[]
  invoice: {
    id: number
    documentType: string
    currency: string
    number: string
    issuedOn: string
    taxable: string
    vat: string
    total: string
    status: SupplierInvoiceStatus
    receivedVia: string
    receivedOn: string
    sdiIdentifier: string | null
    fileName: string
    supplier: { id: number; name: string }
    details: SupplierInvoiceDetails
    spreadDiscounts: boolean
    legalArchiving: {
      state: LegalArchivingState
      at: string
      ids: string[]
      failure: string | null
    } | null
    archivingOffered: boolean
    archivingRetryable: boolean
    discount: string
    spreadable: boolean
    lines: {
      id: number
      lineNumber: number
      code: string | null
      description: string
      quantity: string | null
      unit: string | null
      unitPrice: string
      total: string
      vatRate: string
      natura: string | null
      outcome: LineOutcome | null
      item: LineItem | null
      receipt: { quantity: string; unitCost: string | null; occurredOn: string } | null
      unitCost: string | null
      suggestion: LineItem | null
      candidate: (LineItem & { newestCostOn: string | null }) | null
      manualReceipts: ManualReceipt[]
      defaultAmount: string
      refusal: LineReceiptRefusal | null
    }[]
  }
  picks: Record<string, number>
  receiveOn: string
}>()

type LineItem = { id: number; code: string; description: string; unit: string }
type ManualReceipt = {
  id: number
  occurredOn: string
  quantity: string
  unitCost: string | null
  reference: string | null
  newerCost: boolean
}
type Line = (typeof props.invoice.lines)[number]

const money = (amount: string, decimals = 2) =>
  formatAmount(amount, props.invoice.currency, decimals)
const quantity = (value: string | null) =>
  value === null ? '' : Number(value).toLocaleString('it', { maximumFractionDigits: 8 })

// The header: its line of identifying facts, and the key facts under it
const facts = computed(() =>
  [
    documentTypeLabel(props.invoice.documentType),
    t('ui.supplierInvoices.issuedOnFact', { date: formatDate(props.invoice.issuedOn) }),
    t('ui.supplierInvoices.received', {
      source: t(`ui.supplierInvoices.sources.${props.invoice.receivedVia}`),
      date: formatDate(props.invoice.receivedOn),
    }),
  ].join(' · ')
)
const seller = computed(() => props.invoice.details.seller)
// The payment due next, and how many others the invoice lists
const today = todayIso()
const dueNext = computed(() => nextPayment(props.invoice.details.payments, today))
const otherPayments = computed(() => props.invoice.details.payments.length - 1)
const keyFacts = computed<KeyFact[]>(() => [
  {
    label: t('ui.supplierInvoices.supplier'),
    value: props.invoice.supplier.name,
    href: urlFor('suppliers.edit', { id: props.invoice.supplier.id }),
    hint: `${seller.value.vatCountry}${seller.value.vatNumber}`,
  },
  {
    label: t('ui.supplierInvoices.total'),
    value: money(props.invoice.total),
    amount: true,
    hint: t('ui.supplierInvoices.totalHint', {
      taxable: money(props.invoice.taxable),
      vat: money(props.invoice.vat),
    }),
  },
  {
    label: t('ui.supplierInvoices.dueOn'),
    value: dueNext.value?.dueOn ? formatDate(dueNext.value.dueOn) : '—',
    hint: dueNext.value
      ? [
          paymentMethodLabel(dueNext.value.method),
          money(dueNext.value.amount),
          otherPayments.value > 0 &&
            t('ui.supplierInvoices.otherInstalments', { count: otherPayments.value }),
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined,
  },
])

// The side column's details, one under the other
type Detail = { label: string; value: string; mono?: boolean }
const details = (rows: (Detail | null | false)[]) => rows.filter((row): row is Detail => !!row)
const documentDetails = computed(() => {
  const { invoice } = props
  return details([
    {
      label: t('ui.supplierInvoices.documentType'),
      value: `${documentTypeLabel(invoice.documentType)} (${invoice.documentType})`,
    },
    { label: t('ui.supplierInvoices.number'), value: invoice.number, mono: true },
    { label: t('ui.supplierInvoices.issuedOn'), value: formatDate(invoice.issuedOn) },
    { label: t('ui.supplierInvoices.fileName'), value: invoice.fileName, mono: true },
    invoice.currency !== 'EUR' && {
      label: t('ui.supplierInvoices.currency'),
      value: invoice.currency,
    },
    !!invoice.sdiIdentifier && {
      label: t('ui.supplierInvoices.sdiIdentifier'),
      value: invoice.sdiIdentifier,
      mono: true,
    },
    invoice.details.notes.length > 0 && {
      label: t('ui.supplierInvoices.notes'),
      value: invoice.details.notes.join('\n'),
    },
  ])
})
const sellerAddress = computed(() => {
  const address = seller.value.address
  if (!address) return null
  const street = [address.street, address.streetNumber].filter(Boolean).join(', ')
  const place = [address.postalCode, address.city, address.province && `(${address.province})`]
    .filter(Boolean)
    .join(' ')
  return [street, place, address.country !== 'IT' ? address.country : null]
    .filter(Boolean)
    .join(' · ')
})
const sellerDetails = computed(() =>
  details([
    {
      label: t('ui.supplierInvoices.vatId'),
      value: `${seller.value.vatCountry}${seller.value.vatNumber}`,
      mono: true,
    },
    !!seller.value.taxCode && {
      label: t('ui.supplierInvoices.taxCode'),
      value: seller.value.taxCode,
      mono: true,
    },
    !!sellerAddress.value && { label: t('ui.suppliers.street'), value: sellerAddress.value },
  ])
)
const buyerDetails = computed(() => {
  const { buyer } = props.invoice.details
  return details([
    { label: t('ui.suppliers.name'), value: buyer.name },
    !!buyer.vatNumber && {
      label: t('ui.supplierInvoices.vatId'),
      value: buyer.vatNumber,
      mono: true,
    },
    !!buyer.taxCode && {
      label: t('ui.supplierInvoices.taxCode'),
      value: buyer.taxCode,
      mono: true,
    },
  ])
})

// Another Item than the suggested one: the page comes back with its receipts and costs
const pick = (lineId: number, item: PickedItem) => {
  router.get(
    urlFor('supplier_invoices.show', { id: props.invoice.id }),
    { pick: { ...props.picks, [lineId]: item.id } },
    { preserveState: true, preserveScroll: true, replace: true }
  )
}

/**
 * What Office fills in for each line still to handle: received now or
 * already received (against which receipt by hand, '' for none), the
 * quantity, the cost and the purchase price switch, the last two
 * prefilled (null) until changed.
 */
type LineForm = {
  mode: 'receive' | 'already'
  quantity: string
  occurredOn: string
  receiptId: string
  unitCost: string | null
  updatePurchasePrice: boolean | null
}
const forms = reactive<Record<number, LineForm>>({})
watchEffect(() => {
  for (const line of props.invoice.lines) {
    if (line.outcome !== null || line.id in forms) continue
    forms[line.id] = {
      mode: 'receive',
      quantity: line.quantity === null ? '' : formatQuantity(line.quantity),
      occurredOn: props.receiveOn,
      receiptId: '',
      unitCost: null,
      updatePurchasePrice: null,
    }
  }
})

// The default cost: the line's default amount over the quantity typed
const defaultCost = (line: Line) => {
  const typed = parseQuantity(forms[line.id]?.quantity ?? '')
  if (!typed || typed.lte(0)) return ''
  const cost = receiptUnitCost(line.defaultAmount, typed.toString())
  return cost === null ? '' : amountForInput(cost)
}
const costOf = (line: Line) => forms[line.id]?.unitCost ?? defaultCost(line)

// A newer receipt with a cost exists: the purchase price switch starts off
const newerReceipt = (line: Line) => {
  const form = forms[line.id]
  if (!form || !line.candidate) return false
  if (form.mode === 'receive') return newerCostExists(line.candidate.newestCostOn, form.occurredOn)
  const receipt = line.manualReceipts.find((each) => String(each.id) === form.receiptId)
  return receipt
    ? receipt.newerCost
    : newerCostExists(line.candidate.newestCostOn, props.invoice.issuedOn)
}
const updateOf = (line: Line) => forms[line.id]?.updatePurchasePrice ?? !newerReceipt(line)

/** A code the app names in Italian, or the intermediary's own message as it is */
const archivingFailure = (detail: string | null) =>
  detail && isSdiFailureCode(detail) ? t(`ui.sdiFailures.${detail}`) : (detail ?? '')

// Undoing a receipt takes the quantity back out of stock, so it asks first
const undoOpen = ref(false)
const undoing = ref<number | null>(null)
const undoLine = (lineId: number) =>
  router.post(urlFor('supplier_invoice_lines.undo', { id: lineId }), {}, { preserveScroll: true })
function undo(line: Line) {
  if (line.outcome !== 'received') return undoLine(line.id)
  undoing.value = line.id
  undoOpen.value = true
}
function undoConfirmed() {
  undoOpen.value = false
  if (undoing.value !== null) undoLine(undoing.value)
}

const spread = ref(props.invoice.spreadDiscounts)

// Sending to legal archiving without SDI's identifier: the page's dialog asks it first
const archiveOpen = ref(false)
function openDialog(name: string) {
  if (name === 'archive') archiveOpen.value = true
}

// The Item a line names, previewed over the invoice (docs/ui.md "Hierarchy and
// references"); the inbox's roles may open Items, so every line offers it
const previewedItem = ref<number | null>(null)

const HINT = 'm-0 text-[13px] text-muted-foreground'
const CHECK = 'flex min-h-11 items-center gap-2.5 text-sm md:min-h-8'
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="`${invoice.number} · ${invoice.supplier.name}`"
      :crumbs="[{ label: t('ui.supplierInvoices.title'), href: urlFor('supplier_invoices.index') }]"
      :current="invoice.number"
      :title="
        t('ui.supplierInvoices.showTitle', {
          number: invoice.number,
          supplier: invoice.supplier.name,
        })
      "
      :facts="facts"
      :actions="actions"
      :key-facts="keyFacts"
      @dialog="openDialog"
    >
      <template #tags>
        <StatusTag :tone="SUPPLIER_INVOICE_TONES[invoice.status]">
          {{ t(`ui.supplierInvoices.statuses.${invoice.status}`) }}
        </StatusTag>
      </template>

      <template #main>
        <ScreenSection
          :title="t('ui.supplierInvoices.lines')"
          :description="t('ui.supplierInvoices.linesDescription')"
          flush
        >
          <!-- The discount on the whole invoice, spread over the lines' default costs -->
          <div
            v-if="invoice.discount !== '0.00'"
            class="flex flex-col gap-2 border-t border-border px-3.5 py-3 md:px-4"
            data-testid="spread-discounts"
          >
            <p :class="HINT">
              {{
                t(
                  !invoice.discount.startsWith('-')
                    ? 'ui.supplierInvoices.spreadDiscountsHint'
                    : 'ui.supplierInvoices.surchargeHint',
                  { discount: money(invoice.discount.replace('-', '')) }
                )
              }}
            </p>
            <p v-if="!invoice.spreadable" :class="HINT">
              {{ t('ui.supplierInvoices.notSpreadable') }}
            </p>
            <Form
              v-else
              v-slot="{ processing }"
              route="supplier_invoices.spread_discounts"
              :params="{ id: invoice.id }"
              class="flex flex-wrap items-center gap-x-4 gap-y-1"
            >
              <input type="hidden" name="spreadDiscounts" :value="spread ? 'true' : 'false'" />
              <label :class="CHECK">
                <input v-model="spread" type="checkbox" class="size-4" />
                {{ t('ui.supplierInvoices.spreadDiscounts') }}
              </label>
              <Button type="submit" variant="outline" :class="TOUCH" :disabled="processing">
                {{ t('ui.supplierInvoices.spreadSave') }}
              </Button>
            </Form>
          </div>

          <ul class="m-0 list-none p-0">
            <li
              v-for="line in invoice.lines"
              :key="line.id"
              class="flex flex-col gap-3 border-t border-border px-3.5 py-3 md:px-4"
              data-testid="supplier-invoice-line"
            >
              <!-- The line as the supplier wrote it -->
              <div class="flex items-start gap-2.5">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="text-[13px] text-muted-foreground">
                    {{ t('ui.supplierInvoices.lineHeading', { number: line.lineNumber }) }}
                    <template v-if="line.code">
                      · <span class="font-mono">{{ line.code }}</span>
                    </template>
                  </span>
                  <span class="text-sm font-semibold break-words whitespace-pre-line">
                    {{ line.description }}
                  </span>
                  <span class="text-[13px] text-muted-foreground">
                    <template v-if="line.quantity !== null">
                      {{
                        t('ui.charges.quantityAtPrice', {
                          quantity: `${quantity(line.quantity)} ${line.unit ?? ''}`.trim(),
                          price: money(line.unitPrice, 8),
                        })
                      }}
                      ·
                    </template>
                    {{ t('ui.supplierInvoices.vatRate') }} {{ vatLabel(line) }}
                  </span>
                </div>
                <span class="text-[15px] font-bold whitespace-nowrap">
                  {{ money(line.total, 8) }}
                </span>
              </div>

              <!-- Received onto an Item, already received, or not stock: each can be undone -->
              <div
                v-if="line.outcome !== null"
                class="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-background px-3 py-2"
              >
                <p
                  v-if="line.outcome === 'received' && line.item && line.receipt"
                  class="m-0 text-sm"
                >
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    :class="cn(LINK, PREVIEW_LINK)"
                    @click="previewedItem = line.item.id"
                  >
                    {{
                      t('ui.supplierInvoices.receivedAs', {
                        quantity: formatQuantity(line.receipt.quantity),
                        unit: line.item.unit,
                        code: line.item.code,
                      })
                    }}
                  </button>
                  <template v-if="line.receipt.unitCost">
                    {{
                      t('ui.supplierInvoices.receivedAt', {
                        cost: formatUnitPrice(line.receipt.unitCost),
                        unit: line.item.unit,
                      })
                    }}
                  </template>
                </p>
                <p v-else-if="line.outcome === 'already_received' && line.item" class="m-0 text-sm">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    :class="cn(LINK, PREVIEW_LINK)"
                    @click="previewedItem = line.item.id"
                  >
                    {{ t('ui.supplierInvoices.alreadyReceivedAs', { code: line.item.code }) }}
                  </button>
                  <template v-if="line.receipt">
                    {{
                      t('ui.supplierInvoices.alreadyReceivedWith', {
                        date: formatDate(line.receipt.occurredOn),
                        quantity: formatQuantity(line.receipt.quantity),
                        unit: line.item.unit,
                      })
                    }}
                  </template>
                  <template v-if="line.unitCost">
                    {{
                      t('ui.supplierInvoices.receivedAt', {
                        cost: formatUnitPrice(line.unitCost),
                        unit: line.item.unit,
                      })
                    }}
                  </template>
                </p>
                <StatusTag v-else tone="grey">{{ t('ui.supplierInvoices.notStock') }}</StatusTag>
                <Button variant="outline" :class="TOUCH" @click="undo(line)">
                  {{ t('ui.supplierInvoices.undo') }}
                </Button>
              </div>

              <!-- Only not stock: why it can't be received -->
              <template v-else-if="line.refusal">
                <p :class="HINT">{{ t(`ui.supplierInvoices.refusals.${line.refusal}`) }}</p>
                <Form route="supplier_invoice_lines.mark_not_stock" :params="{ id: line.id }">
                  <Button type="submit" variant="outline" :class="TOUCH">
                    {{ t('ui.supplierInvoices.markNotStock') }}
                  </Button>
                </Form>
              </template>

              <!-- To handle: onto which Item, how, how much and at what cost -->
              <template v-else>
                <Form
                  v-slot="{ processing, errors }"
                  :route="
                    forms[line.id]?.mode === 'already'
                      ? 'supplier_invoice_lines.mark_already_received'
                      : 'supplier_invoice_lines.receive'
                  "
                  :params="{ id: line.id }"
                  class="flex flex-col gap-3"
                >
                  <div v-if="line.candidate" class="flex flex-col gap-1">
                    <p class="m-0 text-sm">
                      <span class="text-muted-foreground">
                        {{
                          line.suggestion?.id === line.candidate.id
                            ? t('ui.supplierInvoices.suggested')
                            : t('ui.supplierInvoices.chosen')
                        }}:
                      </span>
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        :class="cn(LINK, PREVIEW_LINK)"
                        @click="previewedItem = line.candidate.id"
                      >
                        <span class="font-mono">{{ line.candidate.code }}</span> ·
                        {{ line.candidate.description }}
                      </button>
                    </p>
                    <input type="hidden" name="itemId" :value="line.candidate.id" />
                    <!-- A hint, never a block: received by hand recently -->
                    <p v-if="line.manualReceipts.length" :class="HINT">
                      {{
                        t('ui.supplierInvoices.receivedByHand', {
                          date: formatDate(line.manualReceipts[0].occurredOn),
                          quantity: formatQuantity(line.manualReceipts[0].quantity),
                          unit: line.candidate.unit,
                        })
                      }}
                    </p>
                  </div>
                  <p v-else :class="HINT">{{ t('ui.supplierInvoices.noItem') }}</p>
                  <p v-if="errors.itemId" :class="PICKER_ERROR">
                    <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
                    {{ errors.itemId }}
                  </p>
                  <ItemPicker
                    :label="t('ui.supplierInvoices.chooseItem')"
                    @select="(item) => pick(line.id, item)"
                  />

                  <template v-if="line.candidate && forms[line.id]">
                    <fieldset class="m-0 flex flex-col gap-1 border-0 p-0">
                      <legend class="mb-1 p-0 text-sm font-medium">
                        {{ t('ui.supplierInvoices.howToHandle') }}
                      </legend>
                      <div class="flex flex-wrap gap-x-5">
                        <label :class="CHECK">
                          <input
                            v-model="forms[line.id].mode"
                            type="radio"
                            value="receive"
                            class="size-4"
                          />
                          {{ t('ui.supplierInvoices.receive') }}
                        </label>
                        <label :class="CHECK">
                          <input
                            v-model="forms[line.id].mode"
                            type="radio"
                            value="already"
                            class="size-4"
                          />
                          {{ t('ui.supplierInvoices.alreadyReceived') }}
                        </label>
                      </div>
                    </fieldset>
                    <p v-if="unitsDiffer(line.unit, line.candidate.unit)" :class="PICKER_ERROR">
                      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
                      {{
                        t('ui.supplierInvoices.unitsDiffer', {
                          lineUnit: line.unit ?? '',
                          unit: line.candidate.unit,
                        })
                      }}
                    </p>

                    <div class="grid gap-3 md:grid-cols-3 md:items-start">
                      <FormField
                        v-if="forms[line.id].mode === 'already'"
                        :id="`line-${line.id}-receipt`"
                        v-slot="field"
                        :label="t('ui.supplierInvoices.earlierReceipt')"
                        :error="errors.receiptId"
                      >
                        <NativeSelect
                          :id="field.id"
                          v-model="forms[line.id].receiptId"
                          name="receiptId"
                          :aria-invalid="field.invalid"
                          :aria-describedby="field.describedBy"
                        >
                          <option value="">{{ t('ui.supplierInvoices.noEarlierReceipt') }}</option>
                          <option
                            v-for="receipt in line.manualReceipts"
                            :key="receipt.id"
                            :value="String(receipt.id)"
                          >
                            {{
                              t('ui.supplierInvoices.earlierReceiptOption', {
                                date: formatDate(receipt.occurredOn),
                                quantity: formatQuantity(receipt.quantity),
                                unit: line.candidate.unit,
                                reference: receipt.reference ? ` · ${receipt.reference}` : '',
                              })
                            }}
                          </option>
                        </NativeSelect>
                      </FormField>
                      <FormField
                        :id="`line-${line.id}-quantity`"
                        v-slot="field"
                        :label="
                          t(
                            forms[line.id].mode === 'already'
                              ? 'ui.supplierInvoices.costQuantity'
                              : 'ui.supplierInvoices.receiveQuantity',
                            { unit: line.candidate.unit }
                          )
                        "
                        :error="errors.quantity"
                      >
                        <Input
                          :id="field.id"
                          v-model="forms[line.id].quantity"
                          name="quantity"
                          inputmode="decimal"
                          :class="TOUCH"
                          :aria-invalid="field.invalid"
                          :aria-describedby="field.describedBy"
                        />
                      </FormField>
                      <FormField
                        v-if="forms[line.id].mode === 'receive'"
                        :id="`line-${line.id}-date`"
                        v-slot="field"
                        :label="t('ui.supplierInvoices.receiveDate')"
                        :error="errors.occurredOn"
                      >
                        <Input
                          :id="field.id"
                          v-model="forms[line.id].occurredOn"
                          name="occurredOn"
                          type="date"
                          :max="today"
                          :class="TOUCH"
                          :aria-invalid="field.invalid"
                          :aria-describedby="field.describedBy"
                        />
                      </FormField>
                      <FormField
                        :id="`line-${line.id}-cost`"
                        v-slot="field"
                        :label="t('ui.supplierInvoices.unitCost', { unit: line.candidate.unit })"
                        :hint="
                          t('ui.supplierInvoices.unitCostHint', {
                            spread:
                              invoice.spreadDiscounts && invoice.spreadable
                                ? t('ui.supplierInvoices.unitCostSpread')
                                : '',
                          })
                        "
                        :error="errors.unitCost"
                      >
                        <Input
                          :id="field.id"
                          name="unitCost"
                          inputmode="decimal"
                          :class="TOUCH"
                          :model-value="costOf(line)"
                          :aria-invalid="field.invalid"
                          :aria-describedby="field.describedBy"
                          @update:model-value="(value) => (forms[line.id].unitCost = String(value))"
                        />
                      </FormField>
                    </div>

                    <div class="flex flex-col gap-0.5">
                      <!-- Sent either way, so Office's choice is always explicit -->
                      <input
                        type="hidden"
                        name="updatePurchasePrice"
                        :value="updateOf(line) ? 'true' : 'false'"
                      />
                      <label :class="CHECK">
                        <input
                          type="checkbox"
                          class="size-4"
                          :checked="updateOf(line)"
                          @change="
                            forms[line.id].updatePurchasePrice = (
                              $event.target as HTMLInputElement
                            ).checked
                          "
                        />
                        {{ t('ui.supplierInvoices.updatePurchasePrice') }}
                      </label>
                      <p v-if="newerReceipt(line)" :class="HINT">
                        {{ t('ui.supplierInvoices.newerReceipt') }}
                      </p>
                    </div>
                    <Button type="submit" :class="cn(TOUCH, 'self-start')" :disabled="processing">
                      {{
                        forms[line.id].mode === 'already'
                          ? t('ui.supplierInvoices.markAlreadyReceived')
                          : t('ui.supplierInvoices.receive')
                      }}
                    </Button>
                  </template>
                </Form>
                <Form route="supplier_invoice_lines.mark_not_stock" :params="{ id: line.id }">
                  <Button type="submit" variant="outline" :class="TOUCH">
                    {{ t('ui.supplierInvoices.markNotStock') }}
                  </Button>
                </Form>
              </template>
            </li>
          </ul>
        </ScreenSection>
      </template>

      <template #side>
        <ScreenSection :title="t('ui.supplierInvoices.document')">
          <dl class="m-0 flex flex-col gap-2.5 text-sm">
            <div
              v-for="detail in documentDetails"
              :key="detail.label"
              class="flex flex-col gap-0.5"
            >
              <dt class="text-[13px] text-muted-foreground">{{ detail.label }}</dt>
              <dd :class="cn('m-0 break-words whitespace-pre-line', detail.mono && 'font-mono')">
                {{ detail.value }}
              </dd>
            </div>
          </dl>
        </ScreenSection>

        <ScreenSection
          v-if="invoice.legalArchiving || invoice.archivingOffered"
          :title="t('ui.supplierInvoices.legalArchiving')"
          data-testid="legal-archiving"
        >
          <template v-if="invoice.legalArchiving">
            <p
              :class="
                cn(
                  'm-0 text-sm',
                  invoice.legalArchiving.state === 'failed' &&
                    'flex items-start gap-1.5 text-destructive'
                )
              "
            >
              <CircleAlert
                v-if="invoice.legalArchiving.state === 'failed'"
                :size="16"
                aria-hidden="true"
                class="mt-0.5 shrink-0"
              />
              {{
                t(`ui.supplierInvoices.legalArchivingStates.${invoice.legalArchiving.state}`, {
                  at: formatDateTime(invoice.legalArchiving.at),
                  detail: archivingFailure(invoice.legalArchiving.failure),
                })
              }}
            </p>
            <p v-if="invoice.legalArchiving.ids.length" :class="HINT">
              {{ t('ui.supplierInvoices.legalArchivingIds') }}:
              <span class="font-mono break-all">{{ invoice.legalArchiving.ids.join(', ') }}</span>
            </p>
          </template>
          <p v-else :class="HINT">{{ t('ui.supplierInvoices.legalArchivingNone') }}</p>
          <p v-if="invoice.archivingRetryable" :class="HINT">
            {{ t('ui.supplierInvoices.legalArchivingRetryHint') }}
          </p>
        </ScreenSection>

        <ScreenSection :title="t('ui.supplierInvoices.seller')">
          <dl class="m-0 flex flex-col gap-2.5 text-sm">
            <div class="flex flex-col gap-0.5">
              <dt class="text-[13px] text-muted-foreground">
                {{ t('ui.supplierInvoices.supplier') }}
              </dt>
              <dd class="m-0 break-words">
                <Link route="suppliers.edit" :params="{ id: invoice.supplier.id }" :class="LINK">
                  {{ seller.name }}
                </Link>
              </dd>
            </div>
            <div v-for="detail in sellerDetails" :key="detail.label" class="flex flex-col gap-0.5">
              <dt class="text-[13px] text-muted-foreground">{{ detail.label }}</dt>
              <dd :class="cn('m-0 break-words', detail.mono && 'font-mono')">
                {{ detail.value }}
              </dd>
            </div>
          </dl>
        </ScreenSection>

        <ScreenSection :title="t('ui.supplierInvoices.buyer')">
          <dl class="m-0 flex flex-col gap-2.5 text-sm">
            <div v-for="detail in buyerDetails" :key="detail.label" class="flex flex-col gap-0.5">
              <dt class="text-[13px] text-muted-foreground">{{ detail.label }}</dt>
              <dd :class="cn('m-0 break-words', detail.mono && 'font-mono')">
                {{ detail.value }}
              </dd>
            </div>
          </dl>
        </ScreenSection>
      </template>

      <ScreenSection :title="t('ui.supplierInvoices.summary')" flush data-testid="vat-summary">
        <div class="hidden overflow-x-auto md:block">
          <table class="w-full border-collapse">
            <thead>
              <tr>
                <th :class="TH">{{ t('ui.supplierInvoices.vatRate') }}</th>
                <th :class="cn(TH, 'text-right')">{{ t('ui.supplierInvoices.taxable') }}</th>
                <th :class="cn(TH, 'text-right')">{{ t('ui.supplierInvoices.vat') }}</th>
                <th :class="TH">{{ t('ui.supplierInvoices.reference') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in invoice.details.summary" :key="index">
                <td :class="TD">{{ vatLabel(row) }}</td>
                <td :class="cn(TD, 'text-right whitespace-nowrap')">{{ money(row.taxable) }}</td>
                <td :class="cn(TD, 'text-right whitespace-nowrap')">{{ money(row.vat) }}</td>
                <td :class="TD">{{ row.reference ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul class="m-0 list-none p-0 md:hidden">
          <li v-for="(row, index) in invoice.details.summary" :key="index" :class="ROW">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="text-sm font-semibold">{{ vatLabel(row) }}</span>
              <span class="text-[13px] text-muted-foreground">
                {{ t('ui.supplierInvoices.taxable') }} {{ money(row.taxable) }}
                <template v-if="row.reference"> · {{ row.reference }}</template>
              </span>
            </div>
            <span class="text-sm whitespace-nowrap">{{ money(row.vat) }}</span>
          </li>
        </ul>
        <dl
          class="m-0 flex flex-col gap-1 border-t border-border px-3.5 py-3 text-sm md:items-end md:px-4"
        >
          <div class="flex justify-between gap-6 md:justify-end">
            <dt class="text-muted-foreground">{{ t('ui.supplierInvoices.taxable') }}</dt>
            <dd class="m-0 whitespace-nowrap">{{ money(invoice.taxable) }}</dd>
          </div>
          <div class="flex justify-between gap-6 md:justify-end">
            <dt class="text-muted-foreground">{{ t('ui.supplierInvoices.vat') }}</dt>
            <dd class="m-0 whitespace-nowrap">{{ money(invoice.vat) }}</dd>
          </div>
          <div class="flex justify-between gap-6 md:justify-end">
            <dt class="font-semibold">{{ t('ui.supplierInvoices.total') }}</dt>
            <dd class="m-0 font-bold whitespace-nowrap">{{ money(invoice.total) }}</dd>
          </div>
        </dl>
      </ScreenSection>

      <ScreenSection
        v-if="invoice.details.payments.length"
        :title="t('ui.supplierInvoices.payments')"
        flush
      >
        <div class="hidden overflow-x-auto md:block">
          <table class="w-full border-collapse">
            <thead>
              <tr>
                <th :class="TH">{{ t('ui.supplierInvoices.paymentMethod') }}</th>
                <th :class="TH">{{ t('ui.supplierInvoices.dueOn') }}</th>
                <th :class="TH">{{ t('ui.supplierInvoices.iban') }}</th>
                <th :class="cn(TH, 'text-right')">{{ t('ui.supplierInvoices.amount') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(payment, index) in invoice.details.payments" :key="index">
                <td :class="TD">{{ paymentMethodLabel(payment.method) }}</td>
                <td :class="cn(TD, 'whitespace-nowrap')">
                  {{ payment.dueOn ? formatDate(payment.dueOn) : '' }}
                </td>
                <td :class="cn(TD, 'font-mono')">{{ payment.iban ?? '' }}</td>
                <td :class="cn(TD, 'text-right font-semibold whitespace-nowrap')">
                  {{ money(payment.amount) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul class="m-0 list-none p-0 md:hidden">
          <li v-for="(payment, index) in invoice.details.payments" :key="index" :class="ROW">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="text-sm font-semibold">{{ paymentMethodLabel(payment.method) }}</span>
              <span v-if="payment.dueOn" class="text-[13px] text-muted-foreground">
                {{ t('ui.supplierInvoices.dueOn') }} {{ formatDate(payment.dueOn) }}
              </span>
              <span v-if="payment.iban" class="font-mono text-[13px] break-all">
                {{ payment.iban }}
              </span>
            </div>
            <span class="text-[15px] font-bold whitespace-nowrap">
              {{ money(payment.amount) }}
            </span>
          </li>
        </ul>
      </ScreenSection>
    </EntityScreen>

    <!-- Sending an upload to legal archiving: SDI's identifier first (ADR 0019) -->
    <Dialog v-model:open="archiveOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.supplierInvoices.legalArchivingSend') }}</DialogTitle>
        <DialogDescription>{{
          t('ui.supplierInvoices.legalArchivingSdiIdHint')
        }}</DialogDescription>
        <Form
          v-slot="{ processing, errors }"
          route="supplier_invoices.archive"
          :params="{ id: invoice.id }"
          class="flex flex-col gap-4"
          @success="archiveOpen = false"
        >
          <FormField
            id="archiving-sdi-id"
            v-slot="field"
            :label="t('ui.supplierInvoices.sdiIdentifier')"
            :error="errors.sdiId"
          >
            <Input
              :id="field.id"
              name="sdiId"
              inputmode="numeric"
              :class="TOUCH"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="TOUCH" @click="archiveOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="TOUCH" :disabled="processing">
              {{ t('ui.supplierInvoices.legalArchivingSend') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      v-model:open="undoOpen"
      :title="t('ui.supplierInvoices.undoReceipt')"
      :description="t('ui.supplierInvoices.undoConfirm')"
      :confirm-label="t('ui.supplierInvoices.undoReceipt')"
      @confirm="undoConfirmed"
    />

    <ItemPreview v-model:item-id="previewedItem" />
  </AppLayout>
</template>
