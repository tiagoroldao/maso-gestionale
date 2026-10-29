<script setup lang="ts">
import { computed, reactive, ref, watchEffect } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import { router } from '@inertiajs/vue3'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, formatUnitPrice, t, todayIso } from '~/i18n'
import { formatDateTime } from '@shared/dates'
import { vatLabel } from '@shared/vat'
import { formatQuantity } from '@shared/stock'
import { amountForInput, parseQuantity } from '@shared/money'
import { isSdiFailureCode } from '@shared/sdi_failures'
import {
  newerCostExists,
  receiptUnitCost,
  unitsDiffer,
  type LineOutcome,
  type LegalArchivingState,
  type LineReceiptRefusal,
  type SupplierInvoiceDetails,
} from '@shared/supplier_invoices'
import { documentTypeLabel, formatAmount, paymentMethodLabel } from '~/components/supplier_invoices'

const props = defineProps<{
  invoice: {
    id: number
    documentType: string
    currency: string
    number: string
    issuedOn: string
    taxable: string
    vat: string
    total: string
    status: string
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
 * already received, the quantity, the cost and the purchase price switch,
 * the last two prefilled (null) until changed.
 */
type LineForm = {
  mode: 'receive' | 'already'
  quantity: string
  occurredOn: string
  receiptId: number | null
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
      receiptId: null,
      unitCost: null,
      updatePurchasePrice: null,
    }
  }
})

// The default cost: the line's default amount over the quantity typed
const defaultCost = (line: Line) => {
  const quantity = parseQuantity(forms[line.id]?.quantity ?? '')
  if (!quantity || quantity.lte(0)) return ''
  const cost = receiptUnitCost(line.defaultAmount, quantity.toString())
  return cost === null ? '' : amountForInput(cost)
}
const costOf = (line: Line) => forms[line.id]?.unitCost ?? defaultCost(line)

// A newer receipt with a cost exists: the purchase price switch starts off
const newerReceipt = (line: Line) => {
  const form = forms[line.id]
  if (!form || !line.candidate) return false
  if (form.mode === 'receive') return newerCostExists(line.candidate.newestCostOn, form.occurredOn)
  const receipt = line.manualReceipts.find((each) => each.id === form.receiptId)
  return receipt
    ? receipt.newerCost
    : newerCostExists(line.candidate.newestCostOn, props.invoice.issuedOn)
}
const updateOf = (line: Line) => forms[line.id]?.updatePurchasePrice ?? !newerReceipt(line)

/** A code the app names in Italian, or the intermediary's own message as it is */
const archivingFailure = (detail: string | null) =>
  detail && isSdiFailureCode(detail) ? t(`ui.sdiFailures.${detail}`) : (detail ?? '')

const today = todayIso()
const confirmUndo = () => window.confirm(t('ui.supplierInvoices.undoConfirm'))
const spread = ref(props.invoice.spreadDiscounts)

const money = (amount: string, decimals = 2) =>
  formatAmount(amount, props.invoice.currency, decimals)
const seller = computed(() => props.invoice.details.seller)
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
const quantity = (value: string | null) =>
  value === null ? '' : Number(value).toLocaleString('it', { maximumFractionDigits: 8 })
</script>

<template>
  <AppLayout>
    <Page
      :title="
        t('ui.supplierInvoices.showTitle', {
          number: invoice.number,
          supplier: invoice.supplier.name,
        })
      "
      :description="
        t('ui.supplierInvoices.received', {
          source: t(`ui.supplierInvoices.sources.${invoice.receivedVia}`),
          date: formatDate(invoice.receivedOn),
        })
      "
    >
      <template #actions>
        <span class="tag">{{ t(`ui.supplierInvoices.statuses.${invoice.status}`) }}</span>
        <a
          :href="urlFor('supplier_invoices.file', { id: invoice.id })"
          class="btn btn--secondary btn--sm"
        >
          {{ t('ui.supplierInvoices.download', { name: invoice.fileName }) }}
        </a>
      </template>

      <Section :title="t('ui.supplierInvoices.document')">
        <dl class="details">
          <dt>{{ t('ui.supplierInvoices.documentType') }}</dt>
          <dd>{{ documentTypeLabel(invoice.documentType) }} ({{ invoice.documentType }})</dd>
          <dt>{{ t('ui.supplierInvoices.number') }}</dt>
          <dd class="mono">{{ invoice.number }}</dd>
          <dt>{{ t('ui.supplierInvoices.issuedOn') }}</dt>
          <dd>{{ formatDate(invoice.issuedOn) }}</dd>
          <template v-if="invoice.currency !== 'EUR'">
            <dt>{{ t('ui.supplierInvoices.currency') }}</dt>
            <dd>{{ invoice.currency }}</dd>
          </template>
          <template v-if="invoice.sdiIdentifier">
            <dt>{{ t('ui.supplierInvoices.sdiIdentifier') }}</dt>
            <dd class="mono">{{ invoice.sdiIdentifier }}</dd>
          </template>
          <template v-if="invoice.details.notes.length">
            <dt>{{ t('ui.supplierInvoices.notes') }}</dt>
            <dd>
              <p v-for="(note, index) in invoice.details.notes" :key="index">{{ note }}</p>
            </dd>
          </template>
        </dl>
      </Section>

      <Section
        v-if="invoice.legalArchiving || invoice.archivingOffered"
        :title="t('ui.supplierInvoices.legalArchiving')"
      >
        <template v-if="invoice.legalArchiving">
          <p :class="{ field__error: invoice.legalArchiving.state === 'failed' }">
            {{
              t(`ui.supplierInvoices.legalArchivingStates.${invoice.legalArchiving.state}`, {
                at: formatDateTime(invoice.legalArchiving.at),
                detail: archivingFailure(invoice.legalArchiving.failure),
              })
            }}
          </p>
          <p v-if="invoice.legalArchiving.ids.length">
            {{ t('ui.supplierInvoices.legalArchivingIds') }}:
            <span class="mono">{{ invoice.legalArchiving.ids.join(', ') }}</span>
          </p>
        </template>
        <p v-else>{{ t('ui.supplierInvoices.legalArchivingNone') }}</p>
        <Form
          v-if="invoice.archivingRetryable"
          v-slot="{ processing, errors }"
          route="supplier_invoices.archive"
          :params="{ id: invoice.id }"
        >
          <p class="field__hint">{{ t('ui.supplierInvoices.legalArchivingRetryHint') }}</p>
          <div v-if="!invoice.sdiIdentifier" class="field">
            <label class="field__label" for="archiving-sdi-id">{{
              t('ui.supplierInvoices.sdiIdentifier')
            }}</label>
            <input
              id="archiving-sdi-id"
              name="sdiId"
              inputmode="numeric"
              class="field__input"
              :style="{ maxWidth: '240px' }"
            />
            <span class="field__hint">{{ t('ui.supplierInvoices.legalArchivingSdiIdHint') }}</span>
            <span v-if="errors.sdiId" class="field__error">{{ errors.sdiId }}</span>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
            {{ t('ui.supplierInvoices.legalArchivingRetry') }}
          </button>
        </Form>
      </Section>

      <Section :title="t('ui.supplierInvoices.seller')">
        <dl class="details">
          <dt>{{ t('ui.supplierInvoices.supplier') }}</dt>
          <dd>
            <Link route="suppliers.edit" :params="{ id: invoice.supplier.id }" class="il">
              {{ seller.name }}
            </Link>
          </dd>
          <dt>{{ t('ui.supplierInvoices.vatId') }}</dt>
          <dd class="mono">{{ seller.vatCountry }}{{ seller.vatNumber }}</dd>
          <template v-if="seller.taxCode">
            <dt>{{ t('ui.supplierInvoices.taxCode') }}</dt>
            <dd class="mono">{{ seller.taxCode }}</dd>
          </template>
          <template v-if="sellerAddress">
            <dt>{{ t('ui.suppliers.street') }}</dt>
            <dd>{{ sellerAddress }}</dd>
          </template>
        </dl>
      </Section>

      <Section :title="t('ui.supplierInvoices.buyer')">
        <dl class="details">
          <dt>{{ t('ui.suppliers.name') }}</dt>
          <dd>{{ invoice.details.buyer.name }}</dd>
          <template v-if="invoice.details.buyer.vatNumber">
            <dt>{{ t('ui.supplierInvoices.vatId') }}</dt>
            <dd class="mono">{{ invoice.details.buyer.vatNumber }}</dd>
          </template>
          <template v-if="invoice.details.buyer.taxCode">
            <dt>{{ t('ui.supplierInvoices.taxCode') }}</dt>
            <dd class="mono">{{ invoice.details.buyer.taxCode }}</dd>
          </template>
        </dl>
      </Section>

      <Section v-if="invoice.discount !== '0.00'" :title="t('ui.supplierInvoices.spreadDiscounts')">
        <p class="field__hint">
          {{
            t(
              !invoice.discount.startsWith('-')
                ? 'ui.supplierInvoices.spreadDiscountsHint'
                : 'ui.supplierInvoices.surchargeHint',
              { discount: money(invoice.discount.replace('-', '')) }
            )
          }}
        </p>
        <p v-if="!invoice.spreadable" class="field__hint">
          {{ t('ui.supplierInvoices.notSpreadable') }}
        </p>
        <Form v-else route="supplier_invoices.spread_discounts" :params="{ id: invoice.id }">
          <input type="hidden" name="spreadDiscounts" :value="spread ? 'true' : 'false'" />
          <label>
            <input v-model="spread" type="checkbox" />
            {{ t('ui.supplierInvoices.spreadDiscounts') }}
          </label>
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.supplierInvoices.spreadSave') }}
          </button>
        </Form>
      </Section>

      <Section
        :title="t('ui.supplierInvoices.lines')"
        :description="t('ui.supplierInvoices.linesDescription')"
      >
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.supplierInvoices.lineNumber') }}</th>
              <th>{{ t('ui.supplierInvoices.code') }}</th>
              <th>{{ t('ui.supplierInvoices.lineDescription') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.quantity') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.unitPrice') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.lineTotal') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.vatRate') }}</th>
              <th>{{ t('ui.supplierInvoices.handling') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in invoice.lines" :key="line.id">
              <td>{{ line.lineNumber }}</td>
              <td class="mono">{{ line.code ?? '' }}</td>
              <td :style="{ whiteSpace: 'pre-line' }">{{ line.description }}</td>
              <td :style="{ textAlign: 'right' }">
                {{ quantity(line.quantity) }} {{ line.unit ?? '' }}
              </td>
              <td :style="{ textAlign: 'right' }">{{ money(line.unitPrice, 8) }}</td>
              <td :style="{ textAlign: 'right' }">{{ money(line.total, 8) }}</td>
              <td :style="{ textAlign: 'right' }">{{ vatLabel(line) }}</td>
              <td>
                <!-- Received onto an Item, already received, or not stock: each can be undone -->
                <div
                  v-if="line.outcome !== null"
                  :style="{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }"
                >
                  <span v-if="line.outcome === 'received' && line.item && line.receipt">
                    <Link route="items.show" :params="{ id: line.item.id }" class="il">
                      {{
                        t('ui.supplierInvoices.receivedAs', {
                          quantity: formatQuantity(line.receipt.quantity),
                          unit: line.item.unit,
                          code: line.item.code,
                        })
                      }}
                    </Link>
                    <template v-if="line.receipt.unitCost">
                      {{
                        t('ui.supplierInvoices.receivedAt', {
                          cost: formatUnitPrice(line.receipt.unitCost),
                          unit: line.item.unit,
                        })
                      }}
                    </template>
                  </span>
                  <span v-else-if="line.outcome === 'already_received' && line.item">
                    <Link route="items.show" :params="{ id: line.item.id }" class="il">
                      {{ t('ui.supplierInvoices.alreadyReceivedAs', { code: line.item.code }) }}
                    </Link>
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
                  </span>
                  <span v-else class="tag">{{ t('ui.supplierInvoices.notStock') }}</span>
                  <Form
                    route="supplier_invoice_lines.undo"
                    :params="{ id: line.id }"
                    :on-before="() => line.outcome !== 'received' || confirmUndo()"
                  >
                    <button type="submit" class="btn btn--ghost btn--sm">
                      {{ t('ui.supplierInvoices.undo') }}
                    </button>
                  </Form>
                </div>

                <!-- To handle -->
                <template v-else>
                  <p v-if="line.refusal" class="field__hint">
                    {{ t(`ui.supplierInvoices.refusals.${line.refusal}`) }}
                  </p>
                  <Form
                    v-else
                    v-slot="{ processing, errors }"
                    :route="
                      forms[line.id]?.mode === 'already'
                        ? 'supplier_invoice_lines.mark_already_received'
                        : 'supplier_invoice_lines.receive'
                    "
                    :params="{ id: line.id }"
                  >
                    <template v-if="line.candidate">
                      <p>
                        {{
                          line.suggestion?.id === line.candidate.id
                            ? t('ui.supplierInvoices.suggested')
                            : t('ui.supplierInvoices.chosen')
                        }}: <span class="mono">{{ line.candidate.code }}</span> ·
                        {{ line.candidate.description }}
                      </p>
                      <input type="hidden" name="itemId" :value="line.candidate.id" />
                      <!-- A hint, never a block: received by hand recently -->
                      <p v-if="line.manualReceipts.length" class="field__hint">
                        {{
                          t('ui.supplierInvoices.receivedByHand', {
                            date: formatDate(line.manualReceipts[0].occurredOn),
                            quantity: formatQuantity(line.manualReceipts[0].quantity),
                            unit: line.candidate.unit,
                          })
                        }}
                      </p>
                    </template>
                    <p v-else class="field__hint">{{ t('ui.supplierInvoices.noItem') }}</p>
                    <span v-if="errors.itemId" class="field__error">{{ errors.itemId }}</span>
                    <ItemPicker
                      :label="t('ui.supplierInvoices.chooseItem')"
                      @select="(item) => pick(line.id, item)"
                    />
                    <template v-if="line.candidate && forms[line.id]">
                      <fieldset class="field">
                        <legend class="field__label">
                          {{ t('ui.supplierInvoices.howToHandle') }}
                        </legend>
                        <label>
                          <input v-model="forms[line.id].mode" type="radio" value="receive" />
                          {{ t('ui.supplierInvoices.receive') }}
                        </label>
                        <label>
                          <input v-model="forms[line.id].mode" type="radio" value="already" />
                          {{ t('ui.supplierInvoices.alreadyReceived') }}
                        </label>
                      </fieldset>
                      <p v-if="unitsDiffer(line.unit, line.candidate.unit)" class="field__error">
                        {{
                          t('ui.supplierInvoices.unitsDiffer', {
                            lineUnit: line.unit ?? '',
                            unit: line.candidate.unit,
                          })
                        }}
                      </p>
                      <div
                        :style="{
                          display: 'flex',
                          gap: '8px',
                          flexWrap: 'wrap',
                          alignItems: 'flex-start',
                        }"
                      >
                        <div v-if="forms[line.id].mode === 'already'" class="field">
                          <label class="field__label" :for="`line-${line.id}-receipt`">
                            {{ t('ui.supplierInvoices.earlierReceipt') }}
                          </label>
                          <select
                            :id="`line-${line.id}-receipt`"
                            v-model="forms[line.id].receiptId"
                            name="receiptId"
                            class="field__input"
                          >
                            <option :value="null">
                              {{ t('ui.supplierInvoices.noEarlierReceipt') }}
                            </option>
                            <option
                              v-for="receipt in line.manualReceipts"
                              :key="receipt.id"
                              :value="receipt.id"
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
                          </select>
                          <span v-if="errors.receiptId" class="field__error">
                            {{ errors.receiptId }}
                          </span>
                        </div>
                        <div class="field">
                          <label class="field__label" :for="`line-${line.id}-quantity`">
                            {{
                              t(
                                forms[line.id].mode === 'already'
                                  ? 'ui.supplierInvoices.costQuantity'
                                  : 'ui.supplierInvoices.receiveQuantity',
                                { unit: line.candidate.unit }
                              )
                            }}
                          </label>
                          <input
                            :id="`line-${line.id}-quantity`"
                            v-model="forms[line.id].quantity"
                            name="quantity"
                            inputmode="decimal"
                            class="field__input"
                          />
                          <span v-if="errors.quantity" class="field__error">
                            {{ errors.quantity }}
                          </span>
                        </div>
                        <div v-if="forms[line.id].mode === 'receive'" class="field">
                          <label class="field__label" :for="`line-${line.id}-date`">
                            {{ t('ui.supplierInvoices.receiveDate') }}
                          </label>
                          <input
                            :id="`line-${line.id}-date`"
                            v-model="forms[line.id].occurredOn"
                            name="occurredOn"
                            type="date"
                            :max="today"
                            class="field__input"
                          />
                          <span v-if="errors.occurredOn" class="field__error">
                            {{ errors.occurredOn }}
                          </span>
                        </div>
                        <div class="field">
                          <label class="field__label" :for="`line-${line.id}-cost`">
                            {{ t('ui.supplierInvoices.unitCost', { unit: line.candidate.unit }) }}
                          </label>
                          <input
                            :id="`line-${line.id}-cost`"
                            name="unitCost"
                            inputmode="decimal"
                            class="field__input"
                            :value="costOf(line)"
                            @input="
                              forms[line.id].unitCost = ($event.target as HTMLInputElement).value
                            "
                          />
                          <span class="field__hint">
                            {{
                              t('ui.supplierInvoices.unitCostHint', {
                                spread:
                                  invoice.spreadDiscounts && invoice.spreadable
                                    ? t('ui.supplierInvoices.unitCostSpread')
                                    : '',
                              })
                            }}
                          </span>
                          <span v-if="errors.unitCost" class="field__error">
                            {{ errors.unitCost }}
                          </span>
                        </div>
                      </div>
                      <!-- Sent either way, so Office's choice is always explicit -->
                      <input
                        type="hidden"
                        name="updatePurchasePrice"
                        :value="updateOf(line) ? 'true' : 'false'"
                      />
                      <label>
                        <input
                          type="checkbox"
                          :checked="updateOf(line)"
                          @change="
                            forms[line.id].updatePurchasePrice = (
                              $event.target as HTMLInputElement
                            ).checked
                          "
                        />
                        {{ t('ui.supplierInvoices.updatePurchasePrice') }}
                      </label>
                      <p v-if="newerReceipt(line)" class="field__hint">
                        {{ t('ui.supplierInvoices.newerReceipt') }}
                      </p>
                      <button type="submit" class="btn btn--primary btn--sm" :disabled="processing">
                        {{
                          forms[line.id].mode === 'already'
                            ? t('ui.supplierInvoices.markAlreadyReceived')
                            : t('ui.supplierInvoices.receive')
                        }}
                      </button>
                    </template>
                  </Form>
                  <Form route="supplier_invoice_lines.mark_not_stock" :params="{ id: line.id }">
                    <button type="submit" class="btn btn--secondary btn--sm">
                      {{ t('ui.supplierInvoices.markNotStock') }}
                    </button>
                  </Form>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section :title="t('ui.supplierInvoices.summary')">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.supplierInvoices.vatRate') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.taxable') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.vat') }}</th>
              <th>{{ t('ui.supplierInvoices.reference') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in invoice.details.summary" :key="index">
              <td>{{ vatLabel(row) }}</td>
              <td :style="{ textAlign: 'right' }">{{ money(row.taxable) }}</td>
              <td :style="{ textAlign: 'right' }">{{ money(row.vat) }}</td>
              <td>{{ row.reference ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <dl class="details">
          <dt>{{ t('ui.supplierInvoices.taxable') }}</dt>
          <dd>{{ money(invoice.taxable) }}</dd>
          <dt>{{ t('ui.supplierInvoices.vat') }}</dt>
          <dd>{{ money(invoice.vat) }}</dd>
          <dt>{{ t('ui.supplierInvoices.total') }}</dt>
          <dd>
            <strong>{{ money(invoice.total) }}</strong>
          </dd>
        </dl>
      </Section>

      <Section v-if="invoice.details.payments.length" :title="t('ui.supplierInvoices.payments')">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.supplierInvoices.paymentMethod') }}</th>
              <th>{{ t('ui.supplierInvoices.dueOn') }}</th>
              <th>{{ t('ui.supplierInvoices.iban') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.supplierInvoices.amount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(payment, index) in invoice.details.payments" :key="index">
              <td>{{ paymentMethodLabel(payment.method) }}</td>
              <td>{{ payment.dueOn ? formatDate(payment.dueOn) : '' }}</td>
              <td class="mono">{{ payment.iban ?? '' }}</td>
              <td :style="{ textAlign: 'right' }">{{ money(payment.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </Section>
    </Page>
  </AppLayout>
</template>
