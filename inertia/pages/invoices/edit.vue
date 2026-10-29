<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { ArrowDown, ArrowUp, FileText, GripVertical, Merge, Trash2 } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import InvoicePayments from '~/components/invoice_payments.vue'
import { urlFor } from '~/client'
import { formatMoney, t, todayIso } from '~/i18n'
import { formatDate } from '@shared/dates'
import {
  SUBMISSION_OUTCOMES,
  canTransition,
  isDeletable,
  type InvoiceStatus,
} from '@shared/invoice_lifecycle'
import { amountForInput, parseAmount, parseQuantity, sumAmounts } from '@shared/money'
import { invoiceLineTotal, invoiceTotals, type TotalsLine } from '@shared/invoice_totals'
import {
  keptVatTreatment,
  lineKindOf,
  needsSignificantGoodSplit,
  vatLabel,
  type LineKind,
} from '@shared/vat'
import { consumableFolds } from '@shared/combined_lines'
import { DEFAULT_ORGANISE_BY, ORGANISE_BY, inSectionOrder } from '@shared/invoice_sections'
import type { DocumentType } from '@shared/credit_notes'

type Line = {
  key: number
  // The saved line's id, kept across saves; null for a new line
  id: number | null
  // The key of the section it sits in; null outside any (ADR 0018)
  sectionKey: number | null
  itemId: number | null
  description: string
  quantity: string
  unit: string | null
  unitPrice: string
  discountPercent: string
  vatCodeId: number
  significantGood: boolean
  // Billing a Groupable Item: folds with the consumables (ADR 0017)
  groupable: boolean
  // Set on a line taking back an Advance Invoice
  deductsInvoiceId: number | null
  // The Charges the line bills (ADR 0010)
  chargeIds: number[]
  // On a Credit Note, the credited Invoice's line it credits
  creditsLineId: number | null
  // The VAT the line was saved with, and its code then: a Credit Note line
  // keeps its Invoice's, and a kept line keeps it until its code changes
  vatRate: string | null
  natura: string | null
  savedVatCodeId: number | null
}

// A heading over lines on the PDF (ADR 0018)
type InvoiceSection = { key: number; id: number | null; title: string; showSubtotal: boolean }

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
    credits: {
      id: number
      // A Legacy Invoice: no lines, so the Credit Note's lines are free
      legacy: boolean
      number: string
      issuedOn: string
      total: string
      left: string
    } | null
    discountPercent: string
    notes: string | null
    sections: { id: number; title: string; showSubtotal: boolean }[]
    lines: {
      id: number
      sectionId: number | null
      itemId: number | null
      description: string
      quantity: string
      unit: string | null
      unitPrice: string
      discountPercent: string
      vatCodeId: number
      significantGood: boolean
      groupable: boolean
      deductsInvoiceId: number | null
      chargeIds: number[]
      creditsLineId: number | null
      vatRate: string
      natura: string | null
    }[]
  }
  editable: boolean
  // A draft from a Job, which can be organised again (ADR 0018)
  organisable: boolean
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
  openSubmission: {
    id: number
    fileName: string
    submitted: boolean
    automatic: boolean
    sending: boolean
    sendFailure: string | null
    sentByApp: boolean
  } | null
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

function sectionsFromProps(): InvoiceSection[] {
  return props.invoice.sections.map((section) => ({ key: nextKey++, ...section }))
}

function linesFromProps(from: InvoiceSection[]): Line[] {
  const keyOf = new Map(
    props.invoice.sections.map((section, index) => [section.id, from[index].key])
  )
  return props.invoice.lines.map((line) => ({
    key: nextKey++,
    id: line.id,
    sectionKey: line.sectionId ? (keyOf.get(line.sectionId) ?? null) : null,
    itemId: line.itemId,
    description: line.description,
    quantity: trim(line.quantity),
    unit: line.unit,
    unitPrice: amountForInput(line.unitPrice),
    discountPercent: Number(line.discountPercent) ? trim(line.discountPercent) : '',
    vatCodeId: line.vatCodeId,
    significantGood: line.significantGood,
    groupable: line.groupable,
    deductsInvoiceId: line.deductsInvoiceId,
    chargeIds: line.chargeIds,
    creditsLineId: line.creditsLineId,
    vatRate: line.vatRate,
    natura: line.natura,
    savedVatCodeId: line.vatCodeId,
  }))
}

const creditNote = computed(() => props.invoice.documentType === 'credit_note')
// A Credit Note's lines credit its Invoice's, at their VAT; on a Legacy
// Invoice (no lines) they are free, at a VAT Code Office picks (#27)
const fixedLines = computed(() => creditNote.value && !props.invoice.credits?.legacy)

const sections = reactive<InvoiceSection[]>(sectionsFromProps())
const lines = reactive<Line[]>(linesFromProps(sections))
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
    sections: sections.map(({ key: _key, ...section }) => section),
    lines: lines.map(({ key: _key, savedVatCodeId: _saved, sectionKey, ...line }) => ({
      ...line,
      section: sections.findIndex((section) => section.key === sectionKey),
    })),
    deductions: deductionAmounts,
  })
const saved = ref(snapshot())
const dirty = computed(() => snapshot() !== saved.value)

// After a save, show what the server has rather than stale local edits
watch(
  () => props.invoice,
  () => {
    if (Object.keys(errors.value).length) return
    sections.splice(0, sections.length, ...sectionsFromProps())
    lines.splice(0, lines.length, ...linesFromProps(sections))
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
  // A Credit Note line keeps the VAT its Invoice charged; a kept line, the
  // VAT it was saved with until its code changes (as the server does)
  const asSaved =
    line.vatRate !== null && line.savedVatCodeId !== null
      ? { vatCodeId: line.savedVatCodeId, rate: line.vatRate, natura: line.natura }
      : null
  const kept = fixedLines.value ? asSaved : keptVatTreatment(asSaved, line.vatCodeId)
  const code = kept ?? codes.value.get(line.vatCodeId)
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

// New lines go at the end of the last section, near where they are added
const lastSectionKey = () => sections[sections.length - 1]?.key ?? null

function addItem(item: PickedItem & { resalePrice?: string; vatCodeId?: number }) {
  addLine({
    key: nextKey++,
    id: null,
    sectionKey: lastSectionKey(),
    itemId: item.id,
    description: item.description,
    quantity: '1',
    unit: item.unit,
    unitPrice: item.resalePrice ? amountForInput(item.resalePrice) : '',
    discountPercent: '',
    vatCodeId: defaultCode(item),
    significantGood: item.significantGood,
    groupable: false,
    deductsInvoiceId: null,
    chargeIds: [],
    creditsLineId: null,
    vatRate: null,
    natura: null,
    savedVatCodeId: null,
  })
}

function addFreeLine() {
  addLine({
    key: nextKey++,
    id: null,
    sectionKey: lastSectionKey(),
    itemId: null,
    description: '',
    quantity: '1',
    unit: null,
    unitPrice: '',
    discountPercent: '',
    vatCodeId: defaultCode(null),
    significantGood: false,
    groupable: false,
    deductsInvoiceId: null,
    chargeIds: [],
    creditsLineId: null,
    vatRate: null,
    natura: null,
    savedVatCodeId: null,
  })
}

const isDeduction = (line: Line) => line.deductsInvoiceId !== null

/**
 * Puts the lines back in the order they are saved in (as the server
 * numbers them, inSectionOrder()): outside any section first, then each
 * section's in turn, deductions last.
 */
function reorder() {
  const rank = new Map(sections.map((section, index) => [section.key, index]))
  const ordered = inSectionOrder(
    [...lines],
    (line) => (line.sectionKey === null ? null : (rank.get(line.sectionKey) ?? null)),
    isDeduction
  )
  lines.splice(0, lines.length, ...ordered)
}

function addLine(line: Line) {
  lines.push(line)
  reorder()
}

// The groups of lines as shown: outside any section, then each section
const groupKeys = () => [null, ...sections.map((section) => section.key)]
const membersOf = (sectionKey: number | null) =>
  lines.filter((line) => !isDeduction(line) && line.sectionKey === sectionKey)

/**
 * The line one place up or down; past the first or last of its section,
 * it moves into the section before (as its last line) or after (as its
 * first).
 */
function moveLine(line: Line, offset: -1 | 1) {
  const own = membersOf(line.sectionKey)
  const other = own[own.indexOf(line) + offset]
  if (other) {
    const [at, to] = [lines.indexOf(line), lines.indexOf(other)]
    lines.splice(at, 1, other)
    lines.splice(to, 1, line)
    return
  }
  const groups = groupKeys()
  const next = groups[groups.indexOf(line.sectionKey) + offset]
  if (next === undefined) return
  line.sectionKey = next
  reorder()
}

function canMove(line: Line, offset: -1 | 1) {
  const own = membersOf(line.sectionKey)
  const groups = groupKeys()
  return (
    own[own.indexOf(line) + offset] !== undefined ||
    groups[groups.indexOf(line.sectionKey) + offset] !== undefined
  )
}

function removeLine(line: Line) {
  lines.splice(lines.indexOf(line), 1)
}

function addSection() {
  sections.push({
    key: nextKey++,
    id: null,
    title: t('ui.invoices.newSection'),
    showSubtotal: true,
  })
}

function moveSection(index: number, offset: -1 | 1) {
  const [section] = sections.splice(index, 1)
  sections.splice(index + offset, 0, section)
  reorder()
}

/**
 * Removes a section; its lines stay, outside any section (at the top).
 */
function removeSection(index: number) {
  const [section] = sections.splice(index, 1)
  for (const line of lines) if (line.sectionKey === section.key) line.sectionKey = null
  reorder()
}

/**
 * A section's subtotal as the PDF shows it: its lines' amounts added up,
 * before VAT and the global discount (the complete ones).
 */
function subtotalOf(sectionKey: number) {
  return sumAmounts(membersOf(sectionKey).flatMap((line) => amountOf(line) ?? []))
}

// Drag and drop (ADR 0018); the arrows do the same from the keyboard
const dragged = ref<{ line: Line } | { section: InvoiceSection } | null>(null)

/**
 * A line or section dropped on a line: a line takes its place in that
 * line's section (after it when dragged down, before it when dragged up);
 * a section goes where that line's section is.
 */
function dropOnLine(target: Line) {
  const drag = dragged.value
  dragged.value = null
  // Deductions stay last, outside any section
  if (!drag || isDeduction(target)) return
  if ('section' in drag) {
    const at = sections.findIndex((section) => section.key === target.sectionKey)
    if (at >= 0) placeSection(drag.section, at)
    return
  }
  const { line } = drag
  if (line === target) return
  const down = lines.indexOf(line) < lines.indexOf(target)
  lines.splice(lines.indexOf(line), 1)
  lines.splice(lines.indexOf(target) + (down ? 1 : 0), 0, line)
  line.sectionKey = target.sectionKey
  reorder()
}

/**
 * Dropped on a section's heading (null: "outside sections"): a line
 * becomes that section's first; a section takes that place.
 */
function dropOnSection(sectionKey: number | null) {
  const drag = dragged.value
  dragged.value = null
  if (!drag) return
  if ('section' in drag) {
    const at = sections.findIndex((section) => section.key === sectionKey)
    placeSection(drag.section, Math.max(at, 0))
    return
  }
  const { line } = drag
  const first = membersOf(sectionKey).find((other) => other !== line)
  lines.splice(lines.indexOf(line), 1)
  lines.splice(first ? lines.indexOf(first) : 0, 0, line)
  line.sectionKey = sectionKey
  reorder()
}

function placeSection(section: InvoiceSection, at: number) {
  sections.splice(sections.indexOf(section), 1)
  sections.splice(at, 0, section)
  reorder()
}

/**
 * Whether the line can join the one above: both bill Charges, have an
 * amount and share their VAT treatment (the merged line keeps it).
 */
function canMergeUp(index: number) {
  const [above, line] = [lines[index - 1], lines[index]]
  return Boolean(
    above?.sectionKey === line.sectionKey &&
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

/**
 * "Fold consumables" (ADR 0017): the lines of Groupable Items, by VAT
 * treatment and kind (a significant good stays apart, as for mergeUp),
 * within each section (ADR 0018).
 */
const folds = computed(() =>
  consumableFolds(
    lines.map((line) => {
      const values = totalsLine(line)
      return {
        // Lines billing Charges only: a sale's Item lines take it off stock
        groupable: line.groupable && line.itemId !== null && line.chargeIds.length > 0,
        vatKey: `${line.sectionKey}|${line.vatCodeId}|${values?.vatRate}|${values?.natura}|${line.significantGood}`,
        amount: amountOf(line),
      }
    })
  )
)

/**
 * Folds each VAT treatment's Groupable Item lines into one lump line,
 * "Materiale di consumo", 1 × their total, billing all their Charges.
 */
function foldConsumables() {
  const removed = new Set<number>()
  for (const { indices, amount } of folds.value) {
    const [first, ...rest] = indices.map((index) => lines[index])
    Object.assign(first, {
      itemId: null,
      groupable: false,
      description: t('documents.invoice.consumablesLine'),
      quantity: '1',
      unit: null,
      unitPrice: amountForInput(amount),
      discountPercent: '',
      chargeIds: [first, ...rest].flatMap((line) => line.chargeIds),
    })
    for (const line of rest) removed.add(line.key)
  }
  lines.splice(0, lines.length, ...lines.filter((line) => !removed.has(line.key)))
}

const processing = ref(false)

function save() {
  router.put(
    urlFor('invoices.update', { id: props.invoice.id }),
    {
      ...(discountPercent.value && { discountPercent: discountPercent.value }),
      notes: notes.value,
      sections: sections.map((section) => ({
        ...(section.id && { id: section.id }),
        title: section.title,
        showSubtotal: section.showSubtotal,
      })),
      lines: lines.map((line) => ({
        ...(line.id && { id: line.id }),
        ...(line.sectionKey !== null && {
          section: sections.findIndex((section) => section.key === line.sectionKey),
        }),
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

const lineError = (line: Line, field: string) =>
  errors.value[`lines.${lines.indexOf(line)}.${field}`]
const sectionError = (index: number) => errors.value[`sections.${index}.title`]

// Organising again (ADR 0018): by kind and combined unless chosen otherwise
const organiseBy = ref(DEFAULT_ORGANISE_BY)
const organiseCombine = ref(true)
const confirmOrganise = () => window.confirm(t('ui.invoices.organiseConfirm'))

/**
 * The lines table's rows: lines outside any section (under a heading to
 * drop lines on, once there are sections), then each section's heading,
 * lines and subtotal, then deduction lines. A line's position is its
 * place among the lines as saved.
 */
type Row = { key: string } & (
  | { type: 'outside' }
  | { type: 'section'; section: InvoiceSection; index: number }
  | { type: 'subtotal'; section: InvoiceSection }
  | { type: 'line'; line: Line; position: number }
)
const rows = computed<Row[]>(() => {
  const lineRow = (line: Line): Row => ({
    key: `line-${line.key}`,
    type: 'line',
    line,
    position: lines.indexOf(line) + 1,
  })
  return [
    ...(props.editable && sections.length ? [{ key: 'outside', type: 'outside' as const }] : []),
    ...membersOf(null).map(lineRow),
    ...sections.flatMap((section, index): Row[] => [
      { key: `section-${section.key}`, type: 'section', section, index },
      ...membersOf(section.key).map(lineRow),
      ...(section.showSubtotal
        ? [{ key: `subtotal-${section.key}`, type: 'subtotal' as const, section }]
        : []),
    ]),
    ...lines.filter(isDeduction).map(lineRow),
  ]
})
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
const today = todayIso()
const confirmUpload = () => window.confirm(t('ui.invoices.confirmUploadConfirm'))
const confirmSend = () => window.confirm(t('ui.invoices.sendConfirm'))
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
            <template v-for="row in rows" :key="row.key">
              <!-- Where lines outside any section are dropped -->
              <tr
                v-if="row.type === 'outside'"
                data-testid="outside-sections"
                @dragover.prevent
                @drop.prevent="dropOnSection(null)"
              >
                <td colspan="7" class="field__hint">{{ t('ui.invoices.outsideSections') }}</td>
              </tr>
              <tr
                v-else-if="row.type === 'section'"
                data-testid="invoice-section"
                @dragover.prevent
                @drop.prevent="dropOnSection(row.section.key)"
              >
                <td colspan="5">
                  <template v-if="editable">
                    <div :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
                      <span
                        draggable="true"
                        class="iconbtn"
                        :aria-hidden="true"
                        :style="{ cursor: 'grab' }"
                        @dragstart="dragged = { section: row.section }"
                        @dragend="dragged = null"
                      >
                        <GripVertical :size="14" />
                      </span>
                      <input
                        v-model="row.section.title"
                        class="field__input"
                        :aria-label="t('ui.invoices.sectionTitleOf', { position: row.index + 1 })"
                      />
                      <label :style="{ display: 'flex', gap: '4px', whiteSpace: 'nowrap' }">
                        <input v-model="row.section.showSubtotal" type="checkbox" />
                        {{ t('ui.invoices.showSubtotal') }}
                      </label>
                    </div>
                    <span v-if="sectionError(row.index)" class="field__error">
                      {{ sectionError(row.index) }}
                    </span>
                  </template>
                  <strong v-else>{{ row.section.title }}</strong>
                </td>
                <td />
                <td v-if="editable" class="table__actions">
                  <button
                    type="button"
                    class="iconbtn"
                    :disabled="row.index === 0"
                    :aria-label="t('ui.invoices.moveSectionUp')"
                    @click="moveSection(row.index, -1)"
                  >
                    <ArrowUp :size="14" />
                  </button>
                  <button
                    type="button"
                    class="iconbtn"
                    :disabled="row.index === sections.length - 1"
                    :aria-label="t('ui.invoices.moveSectionDown')"
                    @click="moveSection(row.index, 1)"
                  >
                    <ArrowDown :size="14" />
                  </button>
                  <button
                    type="button"
                    class="iconbtn"
                    :aria-label="t('ui.invoices.removeSection')"
                    :title="t('ui.invoices.removeSectionHint')"
                    @click="removeSection(row.index)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </td>
              </tr>
              <tr v-else-if="row.type === 'subtotal'" data-testid="section-subtotal">
                <td colspan="5" :style="{ textAlign: 'right' }">
                  {{ t('ui.invoices.sectionSubtotalOf', { title: row.section.title }) }}
                </td>
                <td :style="{ textAlign: 'right' }">
                  <strong>{{ formatMoney(subtotalOf(row.section.key)) }}</strong>
                </td>
                <td v-if="editable" />
              </tr>
              <tr
                v-else-if="row.type === 'line'"
                @dragover.prevent
                @drop.prevent="dropOnLine(row.line)"
              >
                <td>
                  <span class="field__hint">
                    {{ row.line.itemId ? t('ui.invoices.itemLine') : t('ui.invoices.freeLine') }}
                    <template v-if="row.line.chargeIds.length">
                      · {{ t('ui.invoices.billsCharges', { count: row.line.chargeIds.length }) }}
                    </template>
                  </span>
                  <input
                    v-model="row.line.description"
                    class="field__input"
                    :disabled="!editable || row.line.deductsInvoiceId !== null"
                    :aria-label="t('ui.invoices.descriptionOf', { position: row.position })"
                  />
                  <span v-if="lineError(row.line, 'description')" class="field__error">
                    {{ lineError(row.line, 'description') }}
                  </span>
                  <span v-if="lineError(row.line, 'itemId')" class="field__error">
                    {{ lineError(row.line, 'itemId') }}
                  </span>
                </td>
                <td>
                  <input
                    v-model="row.line.quantity"
                    inputmode="decimal"
                    class="field__input"
                    :disabled="!editable || row.line.deductsInvoiceId !== null"
                    :aria-label="t('ui.invoices.quantityOf', { position: row.position })"
                  />
                  <span class="field__hint">{{ row.line.unit }}</span>
                  <span v-if="lineError(row.line, 'quantity')" class="field__error">
                    {{ lineError(row.line, 'quantity') }}
                  </span>
                </td>
                <td>
                  <input
                    v-model="row.line.unitPrice"
                    inputmode="decimal"
                    class="field__input"
                    :disabled="!editable || row.line.deductsInvoiceId !== null"
                    :aria-label="t('ui.invoices.unitPriceOf', { position: row.position })"
                  />
                  <span v-if="lineError(row.line, 'unitPrice')" class="field__error">
                    {{ lineError(row.line, 'unitPrice') }}
                  </span>
                </td>
                <td>
                  <input
                    v-model="row.line.discountPercent"
                    inputmode="decimal"
                    class="field__input"
                    :disabled="!editable || row.line.deductsInvoiceId !== null"
                    :aria-label="t('ui.invoices.lineDiscountOf', { position: row.position })"
                  />
                  <span v-if="lineError(row.line, 'discountPercent')" class="field__error">
                    {{ lineError(row.line, 'discountPercent') }}
                  </span>
                </td>
                <td>
                  <!-- A Credit Note reverses VAT at the rate the Invoice charged -->
                  <span v-if="fixedLines" data-testid="credited-vat">
                    {{ codes.get(row.line.vatCodeId)?.name ?? '' }}
                    ({{ vatLabel({ vatRate: row.line.vatRate ?? '0', natura: row.line.natura }) }})
                  </span>
                  <select
                    v-else
                    v-model="row.line.vatCodeId"
                    class="field__input"
                    :disabled="!editable || row.line.deductsInvoiceId !== null"
                    :aria-label="t('ui.invoices.vatCodeOf', { position: row.position })"
                  >
                    <option v-for="code in vatCodes" :key="code.id" :value="code.id">
                      {{ code.name }}
                    </option>
                  </select>
                  <span v-if="lineError(row.line, 'vatCodeId')" class="field__error">
                    {{ lineError(row.line, 'vatCodeId') }}
                  </span>
                  <span
                    v-if="splitWarning(row.line)"
                    class="field__hint"
                    data-testid="split-warning"
                  >
                    {{ t('ui.invoices.significantGoodSplit') }}
                  </span>
                </td>
                <td :style="{ textAlign: 'right' }">
                  {{ amountOf(row.line) ? formatMoney(amountOf(row.line)!) : '' }}
                </td>
                <!-- A Credit Note's deduction line is kept or removed whole (ADR 0014) -->
                <td v-if="editable && creditNote && row.line.deductsInvoiceId !== null">
                  <button
                    type="button"
                    class="iconbtn"
                    :aria-label="t('ui.invoices.removeLine')"
                    @click="removeLine(row.line)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </td>
                <td v-else-if="editable && row.line.deductsInvoiceId !== null" />
                <td v-else-if="editable" class="table__actions">
                  <span
                    draggable="true"
                    class="iconbtn"
                    :aria-hidden="true"
                    :style="{ cursor: 'grab' }"
                    @dragstart="dragged = { line: row.line }"
                    @dragend="dragged = null"
                  >
                    <GripVertical :size="14" />
                  </span>
                  <button
                    type="button"
                    class="iconbtn"
                    :disabled="!canMove(row.line, -1)"
                    :aria-label="t('ui.invoices.moveUp')"
                    @click="moveLine(row.line, -1)"
                  >
                    <ArrowUp :size="14" />
                  </button>
                  <button
                    type="button"
                    class="iconbtn"
                    :disabled="!canMove(row.line, 1)"
                    :aria-label="t('ui.invoices.moveDown')"
                    @click="moveLine(row.line, 1)"
                  >
                    <ArrowDown :size="14" />
                  </button>
                  <button
                    v-if="canMergeUp(row.position - 1)"
                    type="button"
                    class="iconbtn"
                    :aria-label="t('ui.invoices.mergeUp')"
                    :title="t('ui.invoices.mergeUp')"
                    @click="mergeUp(row.position - 1)"
                  >
                    <Merge :size="14" />
                  </button>
                  <button
                    type="button"
                    class="iconbtn"
                    :aria-label="t('ui.invoices.removeLine')"
                    @click="removeLine(row.line)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </td>
              </tr>
            </template>
            <tr v-if="lines.length === 0 && sections.length === 0">
              <td colspan="7" :style="{ color: 'var(--subtle)' }">
                {{ t('ui.invoices.noLines') }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="editable">
          <button type="button" class="btn btn--secondary btn--sm" @click="addSection">
            {{ t('ui.invoices.addSection') }}
          </button>
          <span class="field__hint">{{ t('ui.invoices.dragHint') }}</span>
        </p>
      </Section>

      <!-- Organising again replaces the sections (ADR 0018) -->
      <Section
        v-if="editable && organisable"
        :title="t('ui.invoices.sectionsTitle')"
        :description="t('ui.invoices.organiseByHint')"
      >
        <Form route="invoices.organise" :params="{ id: invoice.id }" :on-before="confirmOrganise">
          <input type="hidden" name="combine" :value="organiseCombine ? 'true' : 'false'" />
          <div class="field">
            <label class="field__label" for="organise-by">{{ t('ui.invoices.organiseBy') }}</label>
            <select
              id="organise-by"
              v-model="organiseBy"
              name="organiseBy"
              class="field__input"
              :style="{ maxWidth: '360px' }"
            >
              <option v-for="option in ORGANISE_BY" :key="option" :value="option">
                {{ t(`ui.invoices.organiseOptions.${option}`) }}
              </option>
            </select>
          </div>
          <div class="field">
            <label :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
              <input v-model="organiseCombine" type="checkbox" />
              {{ t('ui.invoices.combineCharges') }}
            </label>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="dirty">
            {{ t('ui.invoices.organise') }}
          </button>
          <span v-if="dirty" class="field__hint">{{ t('ui.invoices.organiseUnsaved') }}</span>
        </Form>
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

      <p v-if="editable && !creditNote && folds.length" data-testid="fold-consumables">
        <button type="button" class="btn btn--secondary btn--sm" @click="foldConsumables">
          {{ t('ui.invoices.foldConsumables') }}
        </button>
        <span class="field__hint">{{ t('ui.invoices.foldConsumablesHint') }}</span>
      </p>

      <!-- A Credit Note's lines are the credited Invoice's, lowered -->
      <Section v-if="editable && !fixedLines" :title="t('ui.invoices.addTitle')">
        <ItemPicker v-if="!creditNote" :label="t('ui.invoices.addItem')" @select="addItem" />
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
            :disabled="!editable || creditNote"
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
          <p v-if="openSubmission.sending">{{ t('ui.invoices.sending') }}</p>
          <p v-if="openSubmission.sendFailure" class="field__error">
            {{ t('ui.invoices.sendFailure', { detail: openSubmission.sendFailure }) }}
          </p>
          <Form
            v-if="!openSubmission.sending"
            route="invoices.confirm_submission"
            :params="{ id: invoice.id }"
            :on-before="openSubmission.automatic ? confirmSend : confirmUpload"
          >
            <button type="submit" class="btn btn--primary btn--sm" :disabled="dirty">
              {{ t(openSubmission.automatic ? 'ui.invoices.send' : 'ui.invoices.confirmUpload') }}
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
        <p v-if="openSubmission?.submitted && openSubmission.sentByApp" class="field__hint">
          {{ t('ui.invoices.outcomePolled') }}
        </p>
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

      <InvoicePayments
        v-if="paymentSummary"
        :invoice-id="invoice.id"
        :payments="payments"
        :summary="paymentSummary"
      />

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
