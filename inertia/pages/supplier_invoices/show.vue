<script setup lang="ts">
import { computed, reactive, watchEffect } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, formatUnitPrice, t, todayIso } from '~/i18n'
import { vatLabel } from '@shared/vat'
import { formatQuantity } from '@shared/stock'
import {
  unitsDiffer,
  type LineOutcome,
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
      receipt: { quantity: string; unitCost: string | null } | null
      suggestion: LineItem | null
      refusal: LineReceiptRefusal | null
    }[]
  }
  receiveOn: string
}>()

type LineItem = { id: number; code: string; description: string; unit: string }

// The Item each line still to handle is received onto: the suggested one until Office picks another
const chosen = reactive<Record<number, LineItem | null>>({})
watchEffect(() => {
  for (const line of props.invoice.lines) {
    if (line.outcome === null && !(line.id in chosen)) chosen[line.id] = line.suggestion
  }
})
const pick = (lineId: number, item: PickedItem) => {
  chosen[lineId] = { id: item.id, code: item.code, description: item.description, unit: item.unit }
}
const today = todayIso()
const confirmUndo = () => window.confirm(t('ui.supplierInvoices.undoConfirm'))

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
                <!-- Received onto an Item, or not stock: either can be undone -->
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
                    route="supplier_invoice_lines.receive"
                    :params="{ id: line.id }"
                  >
                    <template v-if="chosen[line.id]">
                      <p>
                        {{
                          line.suggestion?.id === chosen[line.id]!.id
                            ? t('ui.supplierInvoices.suggested')
                            : t('ui.supplierInvoices.chosen')
                        }}: <span class="mono">{{ chosen[line.id]!.code }}</span> ·
                        {{ chosen[line.id]!.description }}
                      </p>
                      <input type="hidden" name="itemId" :value="chosen[line.id]!.id" />
                    </template>
                    <p v-else class="field__hint">{{ t('ui.supplierInvoices.noItem') }}</p>
                    <span v-if="errors.itemId" class="field__error">{{ errors.itemId }}</span>
                    <ItemPicker
                      :label="t('ui.supplierInvoices.chooseItem')"
                      @select="(item) => pick(line.id, item)"
                    />
                    <template v-if="chosen[line.id]">
                      <p v-if="unitsDiffer(line.unit, chosen[line.id]!.unit)" class="field__error">
                        {{
                          t('ui.supplierInvoices.unitsDiffer', {
                            lineUnit: line.unit ?? '',
                            unit: chosen[line.id]!.unit,
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
                        <div class="field">
                          <label class="field__label" :for="`line-${line.id}-quantity`">
                            {{
                              t('ui.supplierInvoices.receiveQuantity', {
                                unit: chosen[line.id]!.unit,
                              })
                            }}
                          </label>
                          <input
                            :id="`line-${line.id}-quantity`"
                            name="quantity"
                            inputmode="decimal"
                            class="field__input"
                            :value="line.quantity === null ? '' : formatQuantity(line.quantity)"
                          />
                          <span v-if="errors.quantity" class="field__error">
                            {{ errors.quantity }}
                          </span>
                        </div>
                        <div class="field">
                          <label class="field__label" :for="`line-${line.id}-date`">
                            {{ t('ui.supplierInvoices.receiveDate') }}
                          </label>
                          <input
                            :id="`line-${line.id}-date`"
                            name="occurredOn"
                            type="date"
                            :max="today"
                            :value="receiveOn"
                            class="field__input"
                          />
                          <span v-if="errors.occurredOn" class="field__error">
                            {{ errors.occurredOn }}
                          </span>
                        </div>
                        <button
                          type="submit"
                          class="btn btn--primary btn--sm"
                          :disabled="processing"
                          :style="{ marginTop: '22px' }"
                        >
                          {{ t('ui.supplierInvoices.receive') }}
                        </button>
                      </div>
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
