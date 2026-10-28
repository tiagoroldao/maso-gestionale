<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { ArrowDown, ArrowUp, FileText, Merge, Trash2 } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import { urlFor } from '~/client'
import { formatMoney, t, todayIso } from '~/i18n'
import { formatDate } from '@shared/dates'
import {
  SUBMISSION_OUTCOMES,
  canTransition,
  isDeletable,
  type InvoiceStatus,
} from '@shared/invoice_lifecycle'
import { amountForInput, parseAmount, parseQuantity } from '@shared/money'
import { invoiceLineTotal, invoiceTotals, type TotalsLine } from '@shared/invoice_totals'
import { lineKindOf, needsSignificantGoodSplit, type LineKind } from '@shared/vat'
import type { DocumentType } from '@shared/credit_notes'

type Line = {
  key: number
  // The saved line's id, kept across saves; null for a new line
  id: number | null
  itemId: number | null
  description: string
  quantity: string
  unit: string | null
  unitPrice: string
  discountPercent: string
  vatCodeId: number
  significantGood: boolean
  // Set on a line taking back an Advance Invoice
  deductsInvoiceId: number | null
  // The Charges the line bills (ADR 0010)
  chargeIds: number[]
  // On a Credit Note, the credited Invoice's line it credits
  creditsLineId: number | null
  // The VAT the line was saved with: a Credit Note line keeps its Invoice's
  vatRate: string | null
  natura: string | null
}

type VatCodeOption = { id: number; name: string; rate: string; natura: string | null }

const props = defineProps<{
  invoice: {
    id: number
    status: InvoiceStatus
    number: string | null
    issuedOn: string | null
    dueOn: string | null
    customer: { id: number; displayName: string }
    job: { id: number; number: string } | null
    advance: boolean
    documentType: DocumentType
    // A Credit Note's Invoice, and what is left of it to credit
    credits: { id: number; number: string; issuedOn: string; total: string; left: string } | null
    discountPercent: string
    notes: string | null
    lines: {
      id: number
      itemId: number | null
      description: string
      quantity: string
      unit: string | null
      unitPrice: string
      discountPercent: string
      vatCodeId: number
      significantGood: boolean
      deductsInvoiceId: number | null
      chargeIds: number[]
      creditsLineId: number | null
      vatRate: string
      natura: string | null
    }[]
  }
  editable: boolean
  // An Invoice's Credit Notes; null on a Credit Note
  creditNotes:
    { id: number; number: string | null; status: InvoiceStatus; total: string | null }[] | null
  canCredit: boolean
  canSubmit: boolean
  vatCodes: VatCodeOption[]
  // A Job's lines follow the default VAT rules; other lines the Item's code
  vatDefaults: Record<LineKind, number> | null
  standardVatCodeId: number
  submissions: {
    id: number
    fileName: string
    preparedAt: string
    submittedAt: string | null
    outcome: string | null
    noticeOn: string | null
    sdiId: string | null
    outcomeNotes: string | null
    hasFile: boolean
  }[]
  openSubmission: { id: number; fileName: string; submitted: boolean } | null
  resubmitBy: string | null
  unsubmittedCount: number
  payments: { id: number; amount: string; paidOn: string; note: string | null }[]
  // owed is below zero when overpaid, by overpaidBy
  paymentSummary: {
    status: string
    credited: string
    paid: string
    owed: string
    overpaidBy: string | null
  } | null
  // A Job's Invoice: the issued advances it can take back (ADR 0011)
  deductions:
    | { advanceId: number; number: string; total: string; left: string; amount: string | null }[]
    | null
}>()

const page = usePage()
const errors = computed(() => (page.props.errors ?? {}) as Record<string, string>)

let nextKey = 0
const trim = (value: string) => amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')

function linesFromProps(): Line[] {
  return props.invoice.lines.map((line) => ({
    key: nextKey++,
    id: line.id,
    itemId: line.itemId,
    description: line.description,
    quantity: trim(line.quantity),
    unit: line.unit,
    unitPrice: amountForInput(line.unitPrice),
    discountPercent: Number(line.discountPercent) ? trim(line.discountPercent) : '',
    vatCodeId: line.vatCodeId,
    significantGood: line.significantGood,
    deductsInvoiceId: line.deductsInvoiceId,
    chargeIds: line.chargeIds,
    creditsLineId: line.creditsLineId,
    vatRate: line.vatRate,
    natura: line.natura,
  }))
}

const creditNote = computed(() => props.invoice.documentType === 'credit_note')

const lines = reactive<Line[]>(linesFromProps())
const discountPercent = ref(
  Number(props.invoice.discountPercent) ? trim(props.invoice.discountPercent) : ''
)
const notes = ref(props.invoice.notes ?? '')
// What the Invoice takes back of each advance, VAT included, as typed
const deductionsFromProps = () =>
  Object.fromEntries(
    (props.deductions ?? []).map((row) => [
      row.advanceId,
      row.amount ? amountForInput(row.amount) : '',
    ])
  )
const deductionAmounts = reactive<Record<number, string>>(deductionsFromProps())

const snapshot = () =>
  JSON.stringify({
    discountPercent: discountPercent.value,
    notes: notes.value,
    lines: lines.map(({ key: _key, ...line }) => line),
    deductions: deductionAmounts,
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
    Object.assign(deductionAmounts, deductionsFromProps())
    saved.value = snapshot()
  }
)

const codes = computed(() => new Map(props.vatCodes.map((code) => [code.id, code])))
// The server decides defaults (VatDefaults); Item search sends only active codes
function defaultCode(item: { significantGood: boolean; vatCodeId?: number | null } | null) {
  if (props.vatDefaults) return props.vatDefaults[lineKindOf(item)]
  return item?.vatCodeId ?? props.standardVatCodeId
}

function splitWarning(line: Line) {
  const code = codes.value.get(line.vatCodeId)
  return code ? needsSignificantGoodSplit(code, line.significantGood) : false
}

/**
 * A line as the totals module reads it, or null while it is incomplete.
 */
function totalsLine(line: Line): TotalsLine | null {
  const quantity = parseQuantity(line.quantity)
  const price = parseAmount(line.unitPrice)
  const discount = line.discountPercent ? parseAmount(line.discountPercent) : null
  // A Credit Note line keeps the VAT its Invoice charged
  const code =
    creditNote.value && line.vatRate !== null
      ? { rate: line.vatRate, natura: line.natura }
      : codes.value.get(line.vatCodeId)
  if (!quantity || !price || !code || (line.discountPercent && !discount)) return null
  return {
    quantity: quantity.toFixed(),
    unitPrice: price.toFixed(),
    discountPercent: discount?.toFixed() ?? '0',
    vatRate: code.rate,
    natura: code.natura,
    deduction: line.deductsInvoiceId !== null,
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
    id: null,
    itemId: item.id,
    description: item.description,
    quantity: '1',
    unit: item.unit,
    unitPrice: item.resalePrice ? amountForInput(item.resalePrice) : '',
    discountPercent: '',
    vatCodeId: defaultCode(item),
    significantGood: item.significantGood,
    deductsInvoiceId: null,
    chargeIds: [],
    creditsLineId: null,
    vatRate: null,
    natura: null,
  })
}

function addFreeLine() {
  lines.push({
    key: nextKey++,
    id: null,
    itemId: null,
    description: '',
    quantity: '1',
    unit: null,
    unitPrice: '',
    discountPercent: '',
    vatCodeId: defaultCode(null),
    significantGood: false,
    deductsInvoiceId: null,
    chargeIds: [],
    creditsLineId: null,
    vatRate: null,
    natura: null,
  })
}

function move(index: number, offset: number) {
  const [line] = lines.splice(index, 1)
  lines.splice(index + offset, 0, line)
}

/**
 * Whether the line can join the one above: both bill Charges, have an
 * amount and share their VAT treatment (the merged line keeps it).
 */
function canMergeUp(index: number) {
  const [above, line] = [lines[index - 1], lines[index]]
  return Boolean(
    above?.chargeIds.length &&
    line.chargeIds.length &&
    above.vatCodeId === line.vatCodeId &&
    above.significantGood === line.significantGood &&
    amountOf(above) &&
    amountOf(line)
  )
}

/**
 * One line billing both lines' Charges, for their combined amount, at
 * their shared VAT Code.
 */
function mergeUp(index: number) {
  const [above, line] = [lines[index - 1], lines[index]]
  const amount = parseAmount(amountOf(above)!)!.plus(amountOf(line)!)
  Object.assign(above, {
    itemId: null,
    quantity: '1',
    unit: null,
    unitPrice: amountForInput(amount.toFixed(2)),
    discountPercent: '',
    chargeIds: [...above.chargeIds, ...line.chargeIds],
  })
  lines.splice(index, 1)
}

const processing = ref(false)

function save() {
  router.put(
    urlFor('invoices.update', { id: props.invoice.id }),
    {
      ...(discountPercent.value && { discountPercent: discountPercent.value }),
      notes: notes.value,
      lines: lines.map((line) => ({
        ...(line.id && { id: line.id }),
        ...(line.itemId && { itemId: line.itemId }),
        description: line.description,
        ...(line.unit && { unit: line.unit }),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        ...(line.discountPercent && { discountPercent: line.discountPercent }),
        vatCodeId: line.vatCodeId,
        ...(line.deductsInvoiceId && { deductsInvoiceId: line.deductsInvoiceId }),
        ...(line.chargeIds.length && { chargeIds: line.chargeIds }),
        ...(line.creditsLineId && { creditsLineId: line.creditsLineId }),
      })),
      // Deduction lines above are rewritten from these by the server
      ...(props.deductions && {
        deductions: props.deductions
          .filter((row) => deductionAmounts[row.advanceId])
          .map((row) => ({ advanceId: row.advanceId, amount: deductionAmounts[row.advanceId] })),
      }),
    },
    {
      preserveScroll: true,
      onStart: () => (processing.value = true),
      onFinish: () => (processing.value = false),
    }
  )
}

const lineError = (index: number, field: string) => errors.value[`lines.${index}.${field}`]
const deductionError = computed(
  () => Object.entries(errors.value).find(([key]) => key.startsWith('deductions'))?.[1]
)
const confirmDelete = () =>
  window.confirm(
    t(creditNote.value ? 'ui.invoices.deleteCreditNoteConfirm' : 'ui.invoices.deleteConfirm')
  )
const confirmFinalise = () => {
  const question = t(
    creditNote.value ? 'ui.invoices.finaliseCreditNoteConfirm' : 'ui.invoices.finaliseConfirm'
  )
  return window.confirm(
    props.unsubmittedCount
      ? `${t('ui.invoices.unsubmittedWarning', { count: props.unsubmittedCount })}\n\n${question}`
      : question
  )
}
const title = computed(() => {
  if (creditNote.value) {
    return props.invoice.number
      ? t('ui.invoices.creditNoteTitle', { number: props.invoice.number })
      : t('ui.invoices.creditNoteDraftTitle')
  }
  return props.invoice.number
    ? t('ui.invoices.invoiceTitle', { number: props.invoice.number })
    : t('ui.invoices.draftTitle')
})
const confirmRemovePayment = () => window.confirm(t('ui.invoices.removePaymentConfirm'))
const today = todayIso()
const confirmUpload = () => window.confirm(t('ui.invoices.confirmUploadConfirm'))
const dateTime = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10)) : '')
</script>

<template>
  <AppLayout>
    <Page :title="title" :description="invoice.customer.displayName">
      <template #actions>
        <Form v-if="canCredit" route="invoices.store_credit_note" :params="{ id: invoice.id }">
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.invoices.newCreditNote') }}
          </button>
        </Form>
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
        <Link
          v-if="invoice.job"
          route="jobs.show"
          :params="{ id: invoice.job.id }"
          class="btn btn--ghost btn--sm"
        >
          {{ t('ui.invoices.job', { number: invoice.job.number }) }}
        </Link>
        <Link route="invoices.index" class="btn btn--ghost btn--sm">
          {{ t('ui.invoices.backToList') }}
        </Link>
      </template>

      <p v-if="invoice.advance" class="field__hint" data-testid="advance">
        {{ t('ui.invoices.advanceHint') }}
      </p>
      <template v-if="invoice.credits">
        <p data-testid="credits">
          <Link route="invoices.edit" :params="{ id: invoice.credits.id }" class="il">
            {{
              t('ui.invoices.creditsInvoice', {
                number: invoice.credits.number,
                date: formatDate(invoice.credits.issuedOn),
              })
            }}
          </Link>
        </p>
        <p class="field__hint">
          {{ t('ui.invoices.creditNoteHint') }}
          {{
            t('ui.invoices.creditLeft', {
              left: formatMoney(invoice.credits.left),
              total: formatMoney(invoice.credits.total),
            })
          }}
        </p>
      </template>

      <Section>
        <p>
          <span class="tag">{{ t(`ui.invoices.statuses.${invoice.status}`) }}</span>
        </p>
        <p v-if="resubmitBy" class="field__error">
          {{ t('ui.invoices.resubmitBy', { date: formatDate(resubmitBy) }) }}
        </p>
        <p v-if="invoice.number" class="field__hint">
          {{
            invoice.dueOn
              ? t('ui.invoices.issued', {
                  date: formatDate(invoice.issuedOn),
                  due: formatDate(invoice.dueOn),
                })
              : t('ui.invoices.creditNoteIssued', { date: formatDate(invoice.issuedOn) })
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
                  <template v-if="line.chargeIds.length">
                    · {{ t('ui.invoices.billsCharges', { count: line.chargeIds.length }) }}
                  </template>
                </span>
                <input
                  v-model="line.description"
                  class="field__input"
                  :disabled="!editable || line.deductsInvoiceId !== null"
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
                  :disabled="!editable || line.deductsInvoiceId !== null"
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
                  :disabled="!editable || line.deductsInvoiceId !== null"
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
                  :disabled="!editable || line.deductsInvoiceId !== null"
                  :aria-label="t('ui.invoices.lineDiscountOf', { position: index + 1 })"
                />
                <span v-if="lineError(index, 'discountPercent')" class="field__error">
                  {{ lineError(index, 'discountPercent') }}
                </span>
              </td>
              <td>
                <!-- A Credit Note reverses VAT at the rate the Invoice charged -->
                <span v-if="creditNote" data-testid="credited-vat">
                  {{ codes.get(line.vatCodeId)?.name ?? '' }}
                  ({{ vatLabel({ vatRate: line.vatRate ?? '0', natura: line.natura }) }})
                </span>
                <select
                  v-else
                  v-model="line.vatCodeId"
                  class="field__input"
                  :disabled="!editable || line.deductsInvoiceId !== null"
                  :aria-label="t('ui.invoices.vatCodeOf', { position: index + 1 })"
                >
                  <option v-for="code in vatCodes" :key="code.id" :value="code.id">
                    {{ code.name }}
                  </option>
                </select>
                <span v-if="lineError(index, 'vatCodeId')" class="field__error">
                  {{ lineError(index, 'vatCodeId') }}
                </span>
                <span v-if="splitWarning(line)" class="field__hint" data-testid="split-warning">
                  {{ t('ui.invoices.significantGoodSplit') }}
                </span>
              </td>
              <td :style="{ textAlign: 'right' }">
                {{ amountOf(line) ? formatMoney(amountOf(line)!) : '' }}
              </td>
              <td v-if="editable && line.deductsInvoiceId !== null" />
              <td v-else-if="editable" class="table__actions">
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
                  v-if="canMergeUp(index)"
                  type="button"
                  class="iconbtn"
                  :aria-label="t('ui.invoices.mergeUp')"
                  :title="t('ui.invoices.mergeUp')"
                  @click="mergeUp(index)"
                >
                  <Merge :size="14" />
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

      <Section
        v-if="deductions?.length"
        :title="t('ui.invoices.deductionsTitle')"
        :description="t('ui.invoices.deductionsHint')"
      >
        <table class="table" data-testid="deductions">
          <tbody>
            <tr v-for="row in deductions" :key="row.advanceId">
              <td>{{ t('ui.invoices.advanceNumber', { number: row.number }) }}</td>
              <td>
                {{
                  t('ui.invoices.advanceLeft', {
                    left: formatMoney(row.left),
                    total: formatMoney(row.total),
                  })
                }}
              </td>
              <td :style="{ width: '160px' }">
                <input
                  v-model="deductionAmounts[row.advanceId]"
                  inputmode="decimal"
                  class="field__input"
                  :disabled="!editable"
                  :aria-label="t('ui.invoices.deductionOf', { number: row.number })"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <span v-if="deductionError" class="field__error">{{ deductionError }}</span>
      </Section>

      <!-- A Credit Note's lines are the credited Invoice's, lowered -->
      <Section v-if="editable && !creditNote" :title="t('ui.invoices.addTitle')">
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

      <Section v-if="invoice.number" :title="t('ui.invoices.sdiTitle')">
        <template v-if="openSubmission && !openSubmission.submitted">
          <p>
            <a
              :href="urlFor('invoices.xml', { id: invoice.id })"
              class="btn btn--secondary btn--sm"
            >
              {{ t('ui.invoices.downloadXml', { file: openSubmission.fileName }) }}
            </a>
          </p>
          <Form
            route="invoices.confirm_submission"
            :params="{ id: invoice.id }"
            :on-before="confirmUpload"
          >
            <button type="submit" class="btn btn--primary btn--sm" :disabled="dirty">
              {{ t('ui.invoices.confirmUpload') }}
            </button>
          </Form>
        </template>
        <Form
          v-else-if="canSubmit"
          route="invoices.prepare_submission"
          :params="{ id: invoice.id }"
        >
          <button type="submit" class="btn btn--primary btn--sm" :disabled="dirty">
            {{ t('ui.invoices.prepareSubmission') }}
          </button>
        </Form>
        <Form
          v-if="openSubmission?.submitted"
          v-slot="{ processing: recording, errors: outcomeErrors }"
          route="invoices.record_outcome"
          :params="{ id: invoice.id }"
        >
          <div class="field">
            <label class="field__label" for="outcome">{{ t('ui.invoices.outcome') }}</label>
            <select id="outcome" name="outcome" class="field__input" :style="{ maxWidth: '260px' }">
              <option v-for="code in SUBMISSION_OUTCOMES" :key="code" :value="code">
                {{ t(`ui.invoices.outcomes.${code}`) }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="notice-on">{{ t('ui.invoices.noticeOn') }}</label>
            <input
              id="notice-on"
              name="noticeOn"
              type="date"
              class="field__input"
              :value="today"
              :max="today"
              :style="{ maxWidth: '200px' }"
            />
            <span v-if="outcomeErrors.noticeOn" class="field__error">{{
              outcomeErrors.noticeOn
            }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="sdi-id">{{ t('ui.invoices.sdiId') }}</label>
            <input
              id="sdi-id"
              name="sdiId"
              class="field__input"
              inputmode="numeric"
              :style="{ maxWidth: '200px' }"
            />
            <span v-if="outcomeErrors.sdiId" class="field__error">{{ outcomeErrors.sdiId }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="outcome-notes">{{
              t('ui.invoices.outcomeNotes')
            }}</label>
            <textarea id="outcome-notes" name="notes" class="field__input" rows="2" />
            <span class="field__hint">{{ t('ui.invoices.outcomeNotesHint') }}</span>
            <span v-if="outcomeErrors.notes" class="field__error">{{ outcomeErrors.notes }}</span>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="recording">
            {{ t('ui.invoices.recordOutcome') }}
          </button>
        </Form>

        <table v-if="submissions.length" class="table">
          <thead>
            <tr>
              <th>{{ t('ui.invoices.file') }}</th>
              <th>{{ t('ui.invoices.uploadedOn') }}</th>
              <th>{{ t('ui.invoices.outcome') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="submission in submissions" :key="submission.id">
              <td class="mono">
                <a
                  v-if="submission.hasFile"
                  :href="
                    urlFor('invoices.submission_xml', {
                      id: invoice.id,
                      submissionId: submission.id,
                    })
                  "
                  :title="t('ui.invoices.downloadSent')"
                  >{{ submission.fileName }}</a
                >
                <template v-else>{{ submission.fileName }}</template>
              </td>
              <td>{{ dateTime(submission.submittedAt) }}</td>
              <td>
                <template v-if="submission.outcome">
                  {{ t(`ui.invoices.outcomes.${submission.outcome}`) }}
                  · {{ formatDate(submission.noticeOn) }}
                  <span v-if="submission.sdiId" class="mono">· {{ submission.sdiId }}</span>
                  <span v-if="submission.outcomeNotes" class="field__hint">
                    {{ submission.outcomeNotes }}
                  </span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section v-if="creditNotes?.length" :title="t('ui.invoices.creditNotesTitle')">
        <table class="table" data-testid="credit-notes">
          <tbody>
            <tr v-for="note in creditNotes" :key="note.id">
              <td class="mono">
                <Link route="invoices.edit" :params="{ id: note.id }" class="il">
                  {{ note.number ?? t('ui.invoices.creditNoteDraftTitle') }}
                </Link>
              </td>
              <td>
                <span class="tag">{{ t(`ui.invoices.statuses.${note.status}`) }}</span>
              </td>
              <td :style="{ textAlign: 'right' }">
                {{ note.total ? formatMoney(note.total) : '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section v-if="paymentSummary" :title="t('ui.invoices.paymentsTitle')">
        <p v-if="Number(paymentSummary.credited)">
          {{ t('ui.invoices.credited', { amount: formatMoney(paymentSummary.credited) }) }}
        </p>
        <p>
          <span class="tag">{{ t(`ui.invoices.paymentStatuses.${paymentSummary.status}`) }}</span>
          <template v-if="paymentSummary.overpaidBy">
            {{
              t('ui.invoices.overpaidBy', {
                paid: formatMoney(paymentSummary.paid),
                amount: formatMoney(paymentSummary.overpaidBy),
              })
            }}
          </template>
          <template v-else>
            {{
              t('ui.invoices.paidOf', {
                paid: formatMoney(paymentSummary.paid),
                owed: formatMoney(paymentSummary.owed),
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
          :params="{ id: invoice.id }"
          reset-on-success
          :style="{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }"
        >
          <div class="field">
            <label class="field__label" for="payment-amount">{{
              t('ui.invoices.amountPaid')
            }}</label>
            <input id="payment-amount" name="amount" inputmode="decimal" class="field__input" />
            <span class="field__hint">{{ t('ui.invoices.refundHint') }}</span>
            <span v-if="paymentErrors.amount" class="field__error">{{ paymentErrors.amount }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="payment-date">{{ t('ui.invoices.paidOn') }}</label>
            <input
              id="payment-date"
              name="paidOn"
              type="date"
              class="field__input"
              :value="today"
            />
            <span v-if="paymentErrors.paidOn" class="field__error">{{ paymentErrors.paidOn }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="payment-note">{{
              t('ui.invoices.paymentNote')
            }}</label>
            <input id="payment-note" name="note" class="field__input" />
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="paying">
            {{ t('ui.invoices.recordPayment') }}
          </button>
        </Form>
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
          <Form
            v-if="canTransition(invoice.status, 'finalise')"
            route="invoices.finalise"
            :params="{ id: invoice.id }"
            :on-before="confirmFinalise"
          >
            <button type="submit" class="btn btn--secondary" :disabled="dirty || !lines.length">
              {{ creditNote ? t('ui.invoices.finaliseCreditNote') : t('ui.invoices.finalise') }}
            </button>
          </Form>
          <Form
            v-if="isDeletable(invoice.status)"
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
