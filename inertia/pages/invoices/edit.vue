<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { ArrowDown, ArrowUp, FileText, Trash2 } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import { urlFor } from '~/client'
import { formatMoney, t } from '~/i18n'
import { formatDate } from '@shared/dates'
import { amountForInput, parseAmount, parseQuantity } from '@shared/money'
import { invoiceLineTotal, invoiceTotals, type TotalsLine } from '@shared/invoice_totals'

type Line = {
  key: number
  itemId: number | null
  description: string
  quantity: string
  unit: string | null
  unitPrice: string
  discountPercent: string
  vatCodeId: number
}

type VatCodeOption = { id: number; name: string; rate: string; natura: string | null }

const props = defineProps<{
  invoice: {
    id: number
    status: string
    number: string | null
    issuedOn: string | null
    dueOn: string | null
    customer: { id: number; displayName: string }
    discountPercent: string
    notes: string | null
    lines: {
      itemId: number | null
      description: string
      quantity: string
      unit: string | null
      unitPrice: string
      discountPercent: string
      vatCodeId: number
    }[]
  }
  editable: boolean
  vatCodes: VatCodeOption[]
}>()

const page = usePage()
const errors = computed(() => (page.props.errors ?? {}) as Record<string, string>)

let nextKey = 0
const trim = (value: string) => amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')

function linesFromProps(): Line[] {
  return props.invoice.lines.map((line) => ({
    key: nextKey++,
    itemId: line.itemId,
    description: line.description,
    quantity: trim(line.quantity),
    unit: line.unit,
    unitPrice: amountForInput(line.unitPrice),
    discountPercent: Number(line.discountPercent) ? trim(line.discountPercent) : '',
    vatCodeId: line.vatCodeId,
  }))
}

const lines = reactive<Line[]>(linesFromProps())
const discountPercent = ref(
  Number(props.invoice.discountPercent) ? trim(props.invoice.discountPercent) : ''
)
const notes = ref(props.invoice.notes ?? '')

const snapshot = () =>
  JSON.stringify({
    discountPercent: discountPercent.value,
    notes: notes.value,
    lines: lines.map(({ key: _key, ...line }) => line),
  })
const saved = ref(snapshot())
const dirty = computed(() => snapshot() !== saved.value)

// After a save, show what the server has rather than stale local edits
watch(
  () => props.invoice,
  () => {
    if (Object.keys(errors.value).length) return
    lines.splice(0, lines.length, ...linesFromProps())
    discountPercent.value = Number(props.invoice.discountPercent)
      ? trim(props.invoice.discountPercent)
      : ''
    notes.value = props.invoice.notes ?? ''
    saved.value = snapshot()
  }
)

const codes = computed(() => new Map(props.vatCodes.map((code) => [code.id, code])))
// New lines start on the standard rate: the highest rate charging VAT
const standardCode = computed(() => props.vatCodes.find((code) => !code.natura)?.id)

/**
 * A line as the totals module reads it, or null while it is incomplete.
 */
function totalsLine(line: Line): TotalsLine | null {
  const quantity = parseQuantity(line.quantity)
  const price = parseAmount(line.unitPrice)
  const discount = line.discountPercent ? parseAmount(line.discountPercent) : null
  const code = codes.value.get(line.vatCodeId)
  if (!quantity || !price || !code || (line.discountPercent && !discount)) return null
  return {
    quantity: quantity.toFixed(),
    unitPrice: price.toFixed(),
    discountPercent: discount?.toFixed() ?? '0',
    vatRate: code.rate,
    natura: code.natura,
  }
}

function amountOf(line: Line) {
  const values = totalsLine(line)
  return values ? invoiceLineTotal(values.quantity, values.unitPrice, values.discountPercent) : null
}

const totals = computed(() =>
  invoiceTotals(
    lines.flatMap((line) => {
      const values = totalsLine(line)
      return values ? [values] : []
    }),
    parseAmount(discountPercent.value || '0')?.toFixed() ?? '0'
  )
)

function vatLabel(row: { vatRate: string; natura: string | null }) {
  return row.natura ? row.natura : `${trim(row.vatRate)}%`
}

function addItem(item: PickedItem & { resalePrice?: string; vatCodeId?: number }) {
  lines.push({
    key: nextKey++,
    itemId: item.id,
    description: item.description,
    quantity: '1',
    unit: item.unit,
    unitPrice: item.resalePrice ? amountForInput(item.resalePrice) : '',
    discountPercent: '',
    vatCodeId:
      item.vatCodeId && codes.value.has(item.vatCodeId) ? item.vatCodeId : standardCode.value!,
  })
}

function addFreeLine() {
  lines.push({
    key: nextKey++,
    itemId: null,
    description: '',
    quantity: '1',
    unit: null,
    unitPrice: '',
    discountPercent: '',
    vatCodeId: standardCode.value!,
  })
}

function move(index: number, offset: number) {
  const [line] = lines.splice(index, 1)
  lines.splice(index + offset, 0, line)
}

const processing = ref(false)

function save() {
  router.put(
    urlFor('invoices.update', { id: props.invoice.id }),
    {
      ...(discountPercent.value && { discountPercent: discountPercent.value }),
      notes: notes.value,
      lines: lines.map((line) => ({
        ...(line.itemId && { itemId: line.itemId }),
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        ...(line.discountPercent && { discountPercent: line.discountPercent }),
        vatCodeId: line.vatCodeId,
      })),
    },
    {
      preserveScroll: true,
      onStart: () => (processing.value = true),
      onFinish: () => (processing.value = false),
    }
  )
}

const lineError = (index: number, field: string) => errors.value[`lines.${index}.${field}`]
const confirmDelete = () => window.confirm(t('ui.invoices.deleteConfirm'))
const confirmFinalise = () => window.confirm(t('ui.invoices.finaliseConfirm'))
</script>

<template>
  <AppLayout>
    <Page
      :title="
        invoice.number
          ? t('ui.invoices.invoiceTitle', { number: invoice.number })
          : t('ui.invoices.draftTitle')
      "
      :description="invoice.customer.displayName"
    >
      <template #actions>
        <a
          v-if="invoice.number"
          :href="urlFor('invoices.pdf', { id: invoice.id })"
          target="_blank"
          rel="noopener"
          class="btn btn--secondary btn--sm"
        >
          <FileText :size="15" /> {{ t('ui.invoices.pdf') }}
        </a>
        <a
          v-if="invoice.number"
          :href="urlFor('invoices.xml', { id: invoice.id })"
          class="btn btn--secondary btn--sm"
        >
          {{ t('ui.invoices.xml') }}
        </a>
        <Link route="invoices.index" class="btn btn--ghost btn--sm">
          {{ t('ui.invoices.backToList') }}
        </Link>
      </template>

      <Section>
        <p v-if="invoice.number" class="field__hint">
          {{
            t('ui.invoices.issued', {
              date: formatDate(invoice.issuedOn),
              due: formatDate(invoice.dueOn),
            })
          }}
        </p>
        <p v-else-if="!editable" class="field__hint">{{ t('ui.invoices.notEditable') }}</p>

        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.invoices.description') }}</th>
              <th :style="{ width: '100px' }">{{ t('ui.invoices.quantity') }}</th>
              <th :style="{ width: '120px' }">{{ t('ui.invoices.unitPrice') }}</th>
              <th :style="{ width: '90px' }">{{ t('ui.invoices.lineDiscount') }}</th>
              <th :style="{ width: '170px' }">{{ t('ui.invoices.vatCode') }}</th>
              <th :style="{ textAlign: 'right', width: '110px' }">
                {{ t('ui.invoices.amount') }}
              </th>
              <th v-if="editable" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in lines" :key="line.key">
              <td>
                <span class="field__hint">
                  {{ line.itemId ? t('ui.invoices.itemLine') : t('ui.invoices.freeLine') }}
                </span>
                <input
                  v-model="line.description"
                  class="field__input"
                  :disabled="!editable"
                  :aria-label="t('ui.invoices.descriptionOf', { position: index + 1 })"
                />
                <span v-if="lineError(index, 'description')" class="field__error">
                  {{ lineError(index, 'description') }}
                </span>
                <span v-if="lineError(index, 'itemId')" class="field__error">
                  {{ lineError(index, 'itemId') }}
                </span>
              </td>
              <td>
                <input
                  v-model="line.quantity"
                  inputmode="decimal"
                  class="field__input"
                  :disabled="!editable"
                  :aria-label="t('ui.invoices.quantityOf', { position: index + 1 })"
                />
                <span class="field__hint">{{ line.unit }}</span>
                <span v-if="lineError(index, 'quantity')" class="field__error">
                  {{ lineError(index, 'quantity') }}
                </span>
              </td>
              <td>
                <input
                  v-model="line.unitPrice"
                  inputmode="decimal"
                  class="field__input"
                  :disabled="!editable"
                  :aria-label="t('ui.invoices.unitPriceOf', { position: index + 1 })"
                />
                <span v-if="lineError(index, 'unitPrice')" class="field__error">
                  {{ lineError(index, 'unitPrice') }}
                </span>
              </td>
              <td>
                <input
                  v-model="line.discountPercent"
                  inputmode="decimal"
                  class="field__input"
                  :disabled="!editable"
                  :aria-label="t('ui.invoices.lineDiscountOf', { position: index + 1 })"
                />
                <span v-if="lineError(index, 'discountPercent')" class="field__error">
                  {{ lineError(index, 'discountPercent') }}
                </span>
              </td>
              <td>
                <select
                  v-model="line.vatCodeId"
                  class="field__input"
                  :disabled="!editable"
                  :aria-label="t('ui.invoices.vatCodeOf', { position: index + 1 })"
                >
                  <option v-for="code in vatCodes" :key="code.id" :value="code.id">
                    {{ code.name }}
                  </option>
                </select>
                <span v-if="lineError(index, 'vatCodeId')" class="field__error">
                  {{ lineError(index, 'vatCodeId') }}
                </span>
              </td>
              <td :style="{ textAlign: 'right' }">
                {{ amountOf(line) ? formatMoney(amountOf(line)!) : '' }}
              </td>
              <td v-if="editable" class="table__actions">
                <button
                  type="button"
                  class="iconbtn"
                  :disabled="index === 0"
                  :aria-label="t('ui.invoices.moveUp')"
                  @click="move(index, -1)"
                >
                  <ArrowUp :size="14" />
                </button>
                <button
                  type="button"
                  class="iconbtn"
                  :disabled="index === lines.length - 1"
                  :aria-label="t('ui.invoices.moveDown')"
                  @click="move(index, 1)"
                >
                  <ArrowDown :size="14" />
                </button>
                <button
                  type="button"
                  class="iconbtn"
                  :aria-label="t('ui.invoices.removeLine')"
                  @click="lines.splice(index, 1)"
                >
                  <Trash2 :size="14" />
                </button>
              </td>
            </tr>
            <tr v-if="lines.length === 0">
              <td colspan="7" :style="{ color: 'var(--subtle)' }">
                {{ t('ui.invoices.noLines') }}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section v-if="editable" :title="t('ui.invoices.addTitle')">
        <ItemPicker :label="t('ui.invoices.addItem')" @select="addItem" />
        <button type="button" class="btn btn--secondary btn--sm" @click="addFreeLine">
          {{ t('ui.invoices.addFreeLine') }}
        </button>
      </Section>

      <Section :title="t('ui.invoices.totalsTitle')">
        <div class="field">
          <label class="field__label" for="discount">{{ t('ui.invoices.globalDiscount') }}</label>
          <input
            id="discount"
            v-model="discountPercent"
            inputmode="decimal"
            class="field__input"
            :disabled="!editable"
            :style="{ maxWidth: '120px' }"
          />
          <span class="field__hint">{{ t('ui.invoices.globalDiscountHint') }}</span>
          <span v-if="errors.discountPercent" class="field__error">
            {{ errors.discountPercent }}
          </span>
        </div>

        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.invoices.vat') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.invoices.linesTotal') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.invoices.discount') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.invoices.taxable') }}</th>
              <th :style="{ textAlign: 'right' }">{{ t('ui.invoices.vatAmount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in totals.summary" :key="`${row.vatRate}-${row.natura}`">
              <td>{{ vatLabel(row) }}</td>
              <td :style="{ textAlign: 'right' }">{{ formatMoney(row.linesTotal) }}</td>
              <td :style="{ textAlign: 'right' }">{{ formatMoney(row.discount) }}</td>
              <td :style="{ textAlign: 'right' }">{{ formatMoney(row.taxable) }}</td>
              <td :style="{ textAlign: 'right' }">{{ formatMoney(row.vat) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" :style="{ textAlign: 'right' }">{{ t('ui.invoices.taxable') }}</td>
              <td colspan="2" :style="{ textAlign: 'right' }">
                {{ formatMoney(totals.taxable) }}
              </td>
            </tr>
            <tr>
              <td colspan="3" :style="{ textAlign: 'right' }">{{ t('ui.invoices.vatAmount') }}</td>
              <td colspan="2" :style="{ textAlign: 'right' }">{{ formatMoney(totals.vat) }}</td>
            </tr>
            <tr>
              <td colspan="3" :style="{ textAlign: 'right' }">
                <strong>{{ t('ui.invoices.total') }}</strong>
              </td>
              <td colspan="2" :style="{ textAlign: 'right' }" data-testid="invoice-total">
                <strong>{{ formatMoney(totals.total) }}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </Section>

      <Section :title="t('ui.invoices.notes')">
        <textarea
          v-model="notes"
          class="field__input"
          rows="3"
          :disabled="!editable"
          :aria-label="t('ui.invoices.notes')"
        />
        <span v-if="errors.notes" class="field__error">{{ errors.notes }}</span>
      </Section>

      <Section v-if="editable">
        <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }">
          <button type="button" class="btn btn--primary" :disabled="processing" @click="save">
            {{ t('ui.invoices.save') }}
          </button>
          <span v-if="dirty" class="field__hint">{{ t('ui.invoices.unsaved') }}</span>
          <Form route="invoices.finalise" :params="{ id: invoice.id }" :on-before="confirmFinalise">
            <button type="submit" class="btn btn--secondary" :disabled="dirty || !lines.length">
              {{ t('ui.invoices.finalise') }}
            </button>
          </Form>
          <Form
            route="invoices.destroy"
            :params="{ id: invoice.id }"
            :on-before="confirmDelete"
            :style="{ marginLeft: 'auto' }"
          >
            <button type="submit" class="btn btn--ghost btn--sm">
              <Trash2 :size="14" /> {{ t('ui.invoices.delete') }}
            </button>
          </Form>
        </div>
        <span v-if="errors.lines" class="field__error">{{ errors.lines }}</span>
      </Section>
    </Page>
  </AppLayout>
</template>
