<script setup lang="ts">
/**
 * An Invoice, Advance Invoice or Credit Note, an Entity screen on the new
 * UI (docs/ui.md): one screen for drafting it and for following it once
 * issued. Its header actions come from the server, each stage's next step
 * the primary (finalising a draft, then its Submission to SDI). The lines
 * are the main work: editable while it is a draft or after a Rejection,
 * their totals worked out as you type (shared/ rules, run again by the
 * server on save), in Sections moved with the up and down buttons only
 * (ADR 0018 as amended by 0020). An Item on a line opens its preview.
 * Adding lines, the advances it takes back and the notes follow; once
 * issued, its Submissions, Payments and Credit Notes.
 */
import { computed, reactive, ref, watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { ArrowDown, ArrowUp, CircleAlert, Merge, Trash2 } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import ItemPreview from '~/components/item_preview.vue'
import InvoicePayments from '~/components/invoice_payments.vue'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import FormField from '~/components/screen/form_field.vue'
import RowErrors from '~/components/screen/row_errors.vue'
import { useSentRowErrors } from '~/components/screen/sent_row_errors'
import RowField from '~/components/screen/row_field.vue'
import RowHeads from '~/components/screen/row_heads.vue'
import type { KeyFact } from '~/components/screen/key_facts.vue'
import { EMPTY, INVOICE_TONES, LINK, ROW } from '~/components/screen/screen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { NativeSelect } from '~/components/ui/native-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import { urlFor } from '~/client'
import { cn } from '~/lib/utils'
import { formatMoney, formatUnitPrice, t, todayIso } from '~/i18n'
import { formatDate } from '@shared/dates'
import { SUBMISSION_OUTCOMES, type InvoiceStatus } from '@shared/invoice_lifecycle'
import type { ScreenAction } from '@shared/screen_actions'
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
  // The header's actions, for the Invoice's stage
  actions: ScreenAction[]
  // An Item on a line opens its preview, for those who may open the Item
  previewItems: boolean
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
    legalArchiving: boolean
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
    lineErrors.reset()
    sectionErrors.reset()
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

// The fields merging (and folding) writes anew: their errors no longer apply
const MERGE_REPLACES = ['itemId', 'quantity', 'unitPrice', 'discountPercent']

/**
 * One line billing both lines' Charges, for their combined amount, at
 * their shared VAT Code.
 */
function mergeUp(index: number) {
  // Not while a save is in flight: its answer is about the lines before
  if (processing.value) return
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
  lineErrors.clear(above.key, MERGE_REPLACES)
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
  if (processing.value) return
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
    lineErrors.clear(first.key, [...MERGE_REPLACES, 'description'])
    for (const line of rest) removed.add(line.key)
  }
  lines.splice(0, lines.length, ...lines.filter((line) => !removed.has(line.key)))
}

const processing = ref(false)

function save() {
  if (processing.value) return
  lineErrors.send()
  sectionErrors.send()
  // Without an answer, the errors on screen stay those of the last one
  const unanswered = () => {
    lineErrors.cancel()
    sectionErrors.cancel()
  }
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
      onCancel: unanswered,
      onNetworkError: unanswered,
      onHttpException: unanswered,
    }
  )
}

// A line's errors show after its inputs, each naming its field (#226)
const LINE_FIELDS = computed(() => ({
  description: t('ui.invoices.description'),
  itemId: t('ui.invoices.itemLine'),
  quantity: t('ui.invoices.quantity'),
  unitPrice: t('ui.invoices.unitPrice'),
  discountPercent: t('ui.invoices.lineDiscount'),
  vatCodeId: t('ui.invoices.vatCode'),
}))
// Each stays on its line when one is removed, moved or added after a refused save
const lineErrors = useSentRowErrors({
  rows: () => lines,
  errors,
  name: 'lines',
  fields: Object.keys(LINE_FIELDS.value),
})
// A section's title error, on its section the same way
const sectionErrors = useSentRowErrors({
  rows: () => sections,
  errors,
  name: 'sections',
  fields: ['title'],
})
const deductionError = computed(
  () => Object.entries(errors.value).find(([key]) => key.startsWith('deductions'))?.[1]
)

/**
 * The lines as shown: those outside any section (named so once there are
 * sections), each section with its lines, then the deduction lines.
 */
type Group = { key: string; section: InvoiceSection | null; index: number; lines: Line[] }
const groups = computed<Group[]>(() => [
  { key: 'outside', section: null, index: -1, lines: membersOf(null) },
  ...sections.map((section, index) => ({
    key: `section-${section.key}`,
    section,
    index,
    lines: membersOf(section.key),
  })),
  { key: 'deductions', section: null, index: -1, lines: lines.filter(isDeduction) },
])
const position = (line: Line) => lines.indexOf(line) + 1

// Organising again (ADR 0018): by kind and combined unless chosen otherwise
const organiseOpen = ref(false)
const organiseBy = ref(DEFAULT_ORGANISE_BY)
const organiseCombine = ref(true)
// SDI's outcome, recorded by hand when Office uploaded the file (ADR 0019)
const outcomeOpen = ref(false)
const today = todayIso()

// The header: unsaved edits hold back the steps that freeze or replace
// what the server has, not what is on screen
const WAIT_FOR_SAVE = ['finalise', 'prepareSubmission', 'organise']
const screenActions = computed(() =>
  props.actions.map((action) =>
    dirty.value && WAIT_FOR_SAVE.includes(action.name)
      ? { ...action, disabledReason: t('ui.invoices.saveFirst') }
      : action
  )
)
function runAction(name: string) {
  if (name === 'organise') organiseOpen.value = true
  if (name === 'recordOutcome') outcomeOpen.value = true
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
const kind = computed(() =>
  t(
    `ui.invoices.kinds.${creditNote.value ? 'credit_note' : props.invoice.advance ? 'advance' : 'invoice'}`
  )
)
const facts = computed(() =>
  [
    kind.value,
    props.invoice.issuedOn &&
      t('ui.invoices.issuedOn', { date: formatDate(props.invoice.issuedOn) }),
    props.invoice.dueOn && t('ui.invoices.dueOn', { date: formatDate(props.invoice.dueOn) }),
  ]
    .filter(Boolean)
    .join(' · ')
)
const keyFacts = computed<KeyFact[]>(() => {
  const { invoice, paymentSummary } = props
  return [
    {
      label: t('ui.invoices.customer'),
      value: invoice.customer.displayName,
      href: urlFor('customers.show', { id: invoice.customer.id }),
    },
    ...(invoice.credits
      ? [
          {
            label: t('ui.invoices.creditsFact'),
            value: invoice.credits.number,
            href: urlFor('invoices.edit', { id: invoice.credits.id }),
            hint: t('ui.invoices.creditLeft', {
              left: formatMoney(invoice.credits.left),
              total: formatMoney(invoice.credits.total),
            }),
          },
        ]
      : []),
    ...(invoice.job
      ? [
          {
            label: t('ui.invoices.jobFact'),
            value: invoice.job.number,
            href: urlFor('jobs.show', { id: invoice.job.id }),
          },
        ]
      : []),
    {
      label: t('ui.invoices.total'),
      value: formatMoney(totals.value.total),
      amount: true,
      hint: t('ui.invoices.totalHint', {
        taxable: formatMoney(totals.value.taxable),
        vat: formatMoney(totals.value.vat),
      }),
    },
    ...(paymentSummary
      ? [
          {
            label: t('ui.invoices.paidFact'),
            value: formatMoney(paymentSummary.paid),
            // Overpaid: by how much, never a negative amount to collect
            hint: paymentSummary.overpaidBy
              ? t('ui.invoices.overpaidBy', {
                  paid: formatMoney(paymentSummary.paid),
                  amount: formatMoney(paymentSummary.overpaidBy),
                })
              : Number(paymentSummary.owed) > 0
                ? t('ui.invoices.owedHint', { amount: formatMoney(paymentSummary.owed) })
                : undefined,
          },
        ]
      : []),
  ]
})

// The Item a line names, previewed over the Invoice (docs/ui.md "Hierarchy and references")
const previewedItem = ref<number | null>(null)
const PREVIEW_LINK = 'text-left underline decoration-muted-foreground decoration-dotted'

/**
 * A line: on the phone a card (its kind and buttons, the description,
 * then its figures two by two, each named above it); from 768px one row,
 * its fields under the column heads (`RowField`, `RowHeads`, #226). The
 * figures are narrower until 1024px, so the row fits a tablet with room
 * left for the description.
 */
const LINE =
  'grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border px-3.5 py-3 md:flex md:flex-wrap md:items-start md:gap-x-2 md:px-4'
const DESCRIPTION = 'md:min-w-32 md:flex-1 lg:min-w-40'
const QUANTITY = 'md:w-20 lg:w-24'
const PRICE = 'md:w-24 lg:w-28'
const DISCOUNT = 'md:w-14 lg:w-20'
const VAT = 'md:w-28 lg:w-40'
const AMOUNT = 'md:w-20 md:text-right lg:w-28'
const heads = computed(() => [
  { label: t('ui.invoices.description'), class: DESCRIPTION },
  { label: t('ui.invoices.quantity'), class: QUANTITY },
  { label: t('ui.invoices.unitPrice'), class: PRICE },
  { label: t('ui.invoices.lineDiscount'), class: DISCOUNT },
  { label: t('ui.invoices.vatCode'), class: VAT },
  { label: t('ui.invoices.amount'), class: AMOUNT },
])
const FIELD = 'h-11 md:h-9'
// A figure of a line that can no longer change, in its field's place
const READ = 'text-sm md:inline-flex md:min-h-9 md:items-center'
const BUTTON = 'h-11 md:h-9'
const ICON = 'md:size-9'
const ERROR = 'm-0 flex items-start gap-1.5 text-sm text-destructive'
const HINT = 'm-0 text-[13px] text-muted-foreground'
const PAD = 'px-3.5 md:px-4'
const dateOf = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10)) : '')
// What went to SDI: a Submission prepared and not yet sent shows as its file to upload
const history = computed(() =>
  props.submissions.filter(
    (submission) => submission.submittedAt || submission.id !== props.openSubmission?.id
  )
)
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="title"
      :crumbs="[{ label: t('ui.invoices.title'), href: urlFor('invoices.index') }]"
      :current="invoice.number ?? title"
      :title="title"
      :facts="facts"
      :actions="screenActions"
      :key-facts="keyFacts"
      :busy="processing"
      @dialog="runAction"
    >
      <template #tags>
        <StatusTag :tone="INVOICE_TONES[invoice.status]" data-testid="invoice-status">
          {{ t(`ui.invoices.statuses.${invoice.status}`) }}
        </StatusTag>
      </template>

      <template #main>
        <ScreenSection :title="t('ui.invoices.lines')" flush>
          <template #actions>
            <span v-if="dirty" role="status" class="text-[13px] text-muted-foreground">
              {{ t('ui.invoices.unsaved') }}
            </span>
          </template>
          <div class="flex flex-col gap-2 pb-3 empty:hidden" :class="PAD">
            <p v-if="resubmitBy" :class="ERROR">
              <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
              {{ t('ui.invoices.resubmitBy', { date: formatDate(resubmitBy) }) }}
            </p>
            <p v-if="invoice.advance" :class="HINT" data-testid="advance">
              {{ t('ui.invoices.advanceHint') }}
            </p>
            <p v-if="creditNote && editable" :class="HINT">
              {{ t('ui.invoices.creditNoteHint') }}
            </p>
            <p v-if="!invoice.number && !editable" :class="HINT">
              {{ t('ui.invoices.notEditable') }}
            </p>
            <p v-if="editable && (sections.length || lines.length > 1)" :class="HINT">
              {{ t('ui.invoices.moveHint') }}
            </p>
          </div>

          <RowHeads :heads="heads" />

          <template v-for="group in groups" :key="group.key">
            <!-- Outside any section: named once there are sections -->
            <h3
              v-if="group.key === 'outside' && sections.length && (editable || group.lines.length)"
              :class="cn(HINT, 'border-t border-border py-2', PAD)"
              data-testid="outside-sections"
            >
              {{ t('ui.invoices.outsideSections') }}
            </h3>
            <!-- A section's heading: its title, its subtotal switch and its buttons -->
            <div
              v-if="group.section"
              class="flex flex-col gap-1.5 border-t border-border bg-background py-2"
              :class="PAD"
              data-testid="invoice-section"
            >
              <div v-if="editable" class="flex flex-wrap items-center gap-2">
                <Input
                  v-model="group.section.title"
                  form="invoice-form"
                  :class="cn(FIELD, 'min-w-0 flex-[1_1_12rem] font-semibold')"
                  :aria-label="t('ui.invoices.sectionTitleOf', { position: group.index + 1 })"
                  :aria-invalid="sectionErrors.invalid(group.section.key, 'title')"
                />
                <label class="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
                  <input v-model="group.section.showSubtotal" type="checkbox" class="size-4" />
                  {{ t('ui.invoices.showSubtotal') }}
                </label>
                <span class="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-touch"
                    :class="ICON"
                    :disabled="group.index === 0"
                    :aria-label="t('ui.invoices.moveSectionUp')"
                    @click="moveSection(group.index, -1)"
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-touch"
                    :class="ICON"
                    :disabled="group.index === sections.length - 1"
                    :aria-label="t('ui.invoices.moveSectionDown')"
                    @click="moveSection(group.index, 1)"
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-touch"
                    :class="ICON"
                    :aria-label="t('ui.invoices.removeSection')"
                    @click="removeSection(group.index)"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </span>
              </div>
              <h3 v-else class="m-0 text-sm font-semibold">{{ group.section.title }}</h3>
              <p v-if="sectionErrors.error(group.section.key, 'title')" :class="ERROR">
                <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
                {{
                  t('ui.common.fieldError', {
                    field: t('ui.invoices.sectionTitleOf', { position: group.index + 1 }),
                    message: sectionErrors.error(group.section.key, 'title'),
                  })
                }}
              </p>
            </div>

            <ol v-if="group.lines.length" class="m-0 list-none p-0">
              <li
                v-for="line in group.lines"
                :key="line.key"
                :class="LINE"
                :aria-label="t('ui.invoices.lineOf', { position: position(line) })"
              >
                <!-- What the line is, and its own buttons, across the row -->
                <div
                  class="col-span-2 flex min-h-11 items-center gap-2 text-[13px] md:min-h-9 md:basis-full"
                >
                  <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                    <span v-if="isDeduction(line)" class="text-muted-foreground">
                      {{ t('ui.invoices.deductionLine') }}
                    </span>
                    <button
                      v-else-if="line.itemId !== null && previewItems"
                      type="button"
                      aria-haspopup="dialog"
                      :aria-label="t('ui.invoices.previewItemOf', { position: position(line) })"
                      :class="cn(LINK, PREVIEW_LINK, 'flex min-h-11 items-center md:min-h-0')"
                      @click="previewedItem = line.itemId"
                    >
                      {{ t('ui.invoices.itemLine') }}
                    </button>
                    <span v-else class="text-muted-foreground">
                      {{ line.itemId ? t('ui.invoices.itemLine') : t('ui.invoices.freeLine') }}
                    </span>
                    <span v-if="line.chargeIds.length" class="text-muted-foreground">
                      · {{ t('ui.invoices.billsCharges', { count: line.chargeIds.length }) }}
                    </span>
                  </span>
                  <!-- A Credit Note's deduction line is kept or removed whole (ADR 0014) -->
                  <span
                    v-if="editable && (!isDeduction(line) || creditNote)"
                    class="flex shrink-0 items-center gap-1"
                  >
                    <template v-if="!isDeduction(line)">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-touch"
                        :class="ICON"
                        :disabled="!canMove(line, -1)"
                        :aria-label="t('ui.invoices.moveUp')"
                        @click="moveLine(line, -1)"
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-touch"
                        :class="ICON"
                        :disabled="!canMove(line, 1)"
                        :aria-label="t('ui.invoices.moveDown')"
                        @click="moveLine(line, 1)"
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        v-if="canMergeUp(position(line) - 1)"
                        type="button"
                        variant="ghost"
                        size="icon-touch"
                        :class="ICON"
                        :disabled="processing"
                        :aria-label="t('ui.invoices.mergeUp')"
                        @click="mergeUp(position(line) - 1)"
                      >
                        <Merge aria-hidden="true" />
                      </Button>
                    </template>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-touch"
                      :class="ICON"
                      :aria-label="t('ui.invoices.removeLine')"
                      @click="removeLine(line)"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </span>
                </div>

                <div :class="cn('col-span-2 flex min-w-0 flex-col', DESCRIPTION)">
                  <p v-if="!editable" class="m-0 text-sm font-medium md:pt-2">
                    {{ line.description }}
                  </p>
                  <Input
                    v-else
                    v-model="line.description"
                    form="invoice-form"
                    :class="FIELD"
                    :disabled="isDeduction(line)"
                    :aria-label="t('ui.invoices.descriptionOf', { position: position(line) })"
                    :aria-invalid="lineErrors.invalid(line.key, 'description')"
                  />
                </div>
                <RowField :label="t('ui.invoices.quantity')" :class="QUANTITY">
                  <span v-if="!editable" :class="READ">
                    {{ line.quantity }} {{ line.unit ?? '' }}
                  </span>
                  <div v-else class="flex items-center gap-1.5">
                    <Input
                      v-model="line.quantity"
                      form="invoice-form"
                      inputmode="decimal"
                      :class="FIELD"
                      :disabled="isDeduction(line)"
                      :aria-label="t('ui.invoices.quantityOf', { position: position(line) })"
                      :aria-invalid="lineErrors.invalid(line.key, 'quantity')"
                    />
                    <span v-if="line.unit" class="text-[13px] text-muted-foreground">
                      {{ line.unit }}
                    </span>
                  </div>
                </RowField>
                <RowField :label="t('ui.invoices.unitPrice')" :class="PRICE">
                  <span v-if="!editable" :class="READ">{{
                    formatUnitPrice(parseAmount(line.unitPrice)?.toFixed() ?? 0)
                  }}</span>
                  <Input
                    v-else
                    v-model="line.unitPrice"
                    form="invoice-form"
                    inputmode="decimal"
                    :class="FIELD"
                    :disabled="isDeduction(line)"
                    :aria-label="t('ui.invoices.unitPriceOf', { position: position(line) })"
                    :aria-invalid="lineErrors.invalid(line.key, 'unitPrice')"
                  />
                </RowField>
                <RowField :label="t('ui.invoices.lineDiscount')" :class="DISCOUNT">
                  <span v-if="!editable" :class="READ">
                    {{ line.discountPercent ? `${line.discountPercent}%` : '' }}
                  </span>
                  <Input
                    v-else
                    v-model="line.discountPercent"
                    form="invoice-form"
                    inputmode="decimal"
                    :class="FIELD"
                    :disabled="isDeduction(line)"
                    :aria-label="t('ui.invoices.lineDiscountOf', { position: position(line) })"
                    :aria-invalid="lineErrors.invalid(line.key, 'discountPercent')"
                  />
                </RowField>
                <RowField :label="t('ui.invoices.vatCode')" :class="VAT">
                  <!-- A Credit Note reverses VAT at the rate the Invoice charged -->
                  <span v-if="fixedLines" :class="READ" data-testid="credited-vat">
                    {{ codes.get(line.vatCodeId)?.name ?? '' }}
                    ({{ vatLabel({ vatRate: line.vatRate ?? '0', natura: line.natura }) }})
                  </span>
                  <span v-else-if="!editable" :class="READ">
                    {{ codes.get(line.vatCodeId)?.name ?? '' }}
                  </span>
                  <NativeSelect
                    v-else
                    :model-value="String(line.vatCodeId)"
                    :disabled="isDeduction(line)"
                    :aria-label="t('ui.invoices.vatCodeOf', { position: position(line) })"
                    :aria-invalid="lineErrors.invalid(line.key, 'vatCodeId')"
                    @update:model-value="(value) => (line.vatCodeId = Number(value))"
                  >
                    <option v-for="code in vatCodes" :key="code.id" :value="String(code.id)">
                      {{ code.name }}
                    </option>
                  </NativeSelect>
                </RowField>
                <RowField :label="t('ui.invoices.amount')" :class="cn(AMOUNT, 'md:items-end')">
                  <span
                    class="text-[15px] font-semibold whitespace-nowrap md:inline-flex md:h-9 md:items-center md:text-sm"
                  >
                    {{ amountOf(line) ? formatMoney(amountOf(line)!) : '' }}
                  </span>
                </RowField>

                <div
                  v-if="splitWarning(line) || Object.keys(lineErrors.errorsOf(line.key)).length"
                  class="col-span-full flex flex-col gap-1 md:basis-full"
                >
                  <p v-if="splitWarning(line)" :class="HINT" data-testid="split-warning">
                    {{ t('ui.invoices.significantGoodSplit') }}
                  </p>
                  <RowErrors :errors="lineErrors.errorsOf(line.key)" :fields="LINE_FIELDS" />
                </div>
              </li>
            </ol>

            <div
              v-if="group.section?.showSubtotal"
              class="flex justify-end gap-4 border-t border-border py-2 text-sm"
              :class="PAD"
              data-testid="section-subtotal"
            >
              <span>{{ t('ui.invoices.sectionSubtotalOf', { title: group.section.title }) }}</span>
              <strong class="min-w-24 text-right">
                {{ formatMoney(subtotalOf(group.section.key)) }}
              </strong>
            </div>
          </template>

          <p v-if="!lines.length && !sections.length" :class="EMPTY">
            {{ t('ui.invoices.noLines') }}
          </p>
          <p v-if="errors.lines" :class="cn(ERROR, 'border-t border-border py-3', PAD)">
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ errors.lines }}
          </p>

          <!-- The global discount and the totals, as you type -->
          <div
            class="flex flex-col gap-3 border-t border-border py-3 md:flex-row md:items-start md:justify-between"
            :class="PAD"
          >
            <FormField
              v-if="editable && !creditNote"
              id="discount"
              v-slot="field"
              :label="t('ui.invoices.globalDiscount')"
              :hint="t('ui.invoices.globalDiscountHint')"
              :error="errors.discountPercent"
            >
              <Input
                :id="field.id"
                v-model="discountPercent"
                form="invoice-form"
                inputmode="decimal"
                :class="cn(FIELD, 'max-w-32')"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
            <p v-else-if="Number(invoice.discountPercent)" class="m-0 text-sm">
              {{ t('ui.invoices.globalDiscount') }}: {{ discountPercent }}
            </p>
            <span v-else aria-hidden="true" />
            <dl
              class="m-0 flex flex-col gap-1 text-sm tabular-nums md:min-w-72"
              data-testid="invoice-totals"
            >
              <div
                v-for="row in totals.summary"
                :key="`${row.vatRate}-${row.natura}`"
                class="flex justify-end gap-4 text-muted-foreground"
              >
                <dt>
                  {{
                    t('ui.invoices.vatRow', {
                      vat: vatLabel(row),
                      taxable: formatMoney(row.taxable),
                    })
                  }}
                </dt>
                <dd class="m-0 min-w-24 text-right">{{ formatMoney(row.vat) }}</dd>
              </div>
              <div v-if="Number(totals.discount)" class="flex justify-end gap-4">
                <dt>{{ t('ui.invoices.discount') }}</dt>
                <dd class="m-0 min-w-24 text-right">−{{ formatMoney(totals.discount) }}</dd>
              </div>
              <div class="flex justify-end gap-4">
                <dt>{{ t('ui.invoices.taxable') }}</dt>
                <dd class="m-0 min-w-24 text-right">{{ formatMoney(totals.taxable) }}</dd>
              </div>
              <div class="flex justify-end gap-4">
                <dt>{{ t('ui.invoices.vatAmount') }}</dt>
                <dd class="m-0 min-w-24 text-right">{{ formatMoney(totals.vat) }}</dd>
              </div>
              <div class="flex justify-end gap-4 text-[15px] font-bold">
                <dt>{{ t('ui.invoices.total') }}</dt>
                <dd class="m-0 min-w-24 text-right" data-testid="invoice-total">
                  {{ formatMoney(totals.total) }}
                </dd>
              </div>
            </dl>
          </div>
        </ScreenSection>
      </template>

      <div class="grid items-start gap-3 md:grid-cols-2 md:gap-5">
        <!-- A Credit Note's lines are the credited Invoice's, lowered; its sections can change -->
        <ScreenSection v-if="editable" :title="t('ui.invoices.addTitle')">
          <ItemPicker v-if="!creditNote" :label="t('ui.invoices.addItem')" @select="addItem" />
          <div class="flex flex-wrap gap-2">
            <Button
              v-if="!fixedLines"
              type="button"
              variant="outline"
              :class="BUTTON"
              @click="addFreeLine"
            >
              {{ t('ui.invoices.addFreeLine') }}
            </Button>
            <Button type="button" variant="outline" :class="BUTTON" @click="addSection">
              {{ t('ui.invoices.addSection') }}
            </Button>
          </div>
          <div
            v-if="!creditNote && folds.length"
            class="flex flex-col gap-1.5"
            data-testid="fold-consumables"
          >
            <Button
              type="button"
              variant="outline"
              :class="cn(BUTTON, 'self-start')"
              :disabled="processing"
              @click="foldConsumables"
            >
              {{ t('ui.invoices.foldConsumables') }}
            </Button>
            <p :class="HINT">{{ t('ui.invoices.foldConsumablesHint') }}</p>
          </div>
        </ScreenSection>

        <ScreenSection
          v-if="deductions?.length"
          :title="t('ui.invoices.deductionsTitle')"
          :description="t('ui.invoices.deductionsHint')"
          flush
        >
          <ul class="m-0 list-none p-0" data-testid="deductions">
            <li
              v-for="row in deductions"
              :key="row.advanceId"
              :class="cn(ROW, 'flex-wrap items-center justify-between md:px-4')"
            >
              <div class="flex min-w-0 flex-col gap-0.5 text-sm">
                <span class="font-semibold">
                  {{ t('ui.invoices.advanceNumber', { number: row.number }) }}
                </span>
                <span :class="HINT">
                  {{
                    t('ui.invoices.advanceLeft', {
                      left: formatMoney(row.left),
                      total: formatMoney(row.total),
                    })
                  }}
                </span>
              </div>
              <span v-if="!editable" class="text-sm font-semibold">
                {{ row.amount ? formatMoney(row.amount) : '' }}
              </span>
              <Input
                v-else
                v-model="deductionAmounts[row.advanceId]"
                form="invoice-form"
                inputmode="decimal"
                :class="cn(FIELD, 'w-36')"
                :aria-label="t('ui.invoices.deductionOf', { number: row.number })"
              />
            </li>
          </ul>
          <p v-if="deductionError" :class="cn(ERROR, 'border-t border-border py-3', PAD)">
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ deductionError }}
          </p>
        </ScreenSection>

        <ScreenSection v-if="invoice.number" :title="t('ui.invoices.sdiTitle')" flush>
          <div class="flex flex-col gap-2 pb-3 empty:hidden" :class="PAD">
            <template v-if="openSubmission && !openSubmission.submitted">
              <a
                :href="urlFor('invoices.xml', { id: invoice.id })"
                download
                :class="cn(LINK, 'self-start text-sm')"
              >
                {{ t('ui.invoices.downloadXml', { file: openSubmission.fileName }) }}
              </a>
              <p v-if="openSubmission.sending" :class="HINT">{{ t('ui.invoices.sending') }}</p>
              <p v-if="openSubmission.sendFailure" :class="ERROR">
                <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
                {{ t('ui.invoices.sendFailure', { detail: openSubmission.sendFailure }) }}
              </p>
            </template>
            <p v-if="openSubmission?.submitted && openSubmission.sentByApp" :class="HINT">
              {{ t('ui.invoices.outcomePolled') }}
            </p>
          </div>
          <ul v-if="history.length" class="m-0 list-none p-0" data-testid="submissions">
            <li
              v-for="submission in history"
              :key="submission.id"
              :class="cn(ROW, 'flex-col gap-1 md:px-4')"
            >
              <a
                v-if="submission.hasFile"
                :href="
                  urlFor('invoices.submission_xml', {
                    id: invoice.id,
                    submissionId: submission.id,
                  })
                "
                download
                :title="t('ui.invoices.downloadSent')"
                :class="cn(LINK, 'font-mono text-sm')"
                >{{ submission.fileName }}</a
              >
              <span v-else class="font-mono text-sm">{{ submission.fileName }}</span>
              <span :class="HINT">
                {{
                  [
                    submission.submittedAt &&
                      `${t('ui.invoices.uploadedOn')} ${dateOf(submission.submittedAt)}`,
                    submission.legalArchiving && t('ui.invoices.legalArchivingRequested'),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }}
              </span>
              <span v-if="submission.outcome" class="text-sm">
                {{ t(`ui.invoices.outcomes.${submission.outcome}`) }}
                · {{ formatDate(submission.noticeOn) }}
                <span v-if="submission.sdiId" class="font-mono">· {{ submission.sdiId }}</span>
              </span>
              <span v-if="submission.outcomeNotes" :class="HINT">
                {{ submission.outcomeNotes }}
              </span>
            </li>
          </ul>
          <p v-else-if="!openSubmission" :class="EMPTY">{{ t('ui.invoices.noSubmissions') }}</p>
        </ScreenSection>

        <InvoicePayments
          v-if="paymentSummary"
          :invoice-id="invoice.id"
          :payments="payments"
          :summary="paymentSummary"
        />

        <ScreenSection v-if="creditNotes?.length" :title="t('ui.invoices.creditNotesTitle')" flush>
          <ul class="m-0 list-none p-0" data-testid="credit-notes">
            <li v-for="note in creditNotes" :key="note.id" :class="cn(ROW, 'items-center md:px-4')">
              <Link
                route="invoices.edit"
                :params="{ id: note.id }"
                :class="cn(LINK, 'min-w-0 flex-1 text-sm')"
              >
                {{ note.number ?? t('ui.invoices.creditNoteDraftTitle') }}
              </Link>
              <StatusTag :tone="INVOICE_TONES[note.status]">
                {{ t(`ui.invoices.statuses.${note.status}`) }}
              </StatusTag>
              <span class="min-w-20 text-right text-sm font-semibold">
                {{ note.total ? formatMoney(note.total) : '' }}
              </span>
            </li>
          </ul>
        </ScreenSection>

        <ScreenSection v-if="editable" :title="t('ui.invoices.notes')">
          <Textarea
            v-model="notes"
            rows="3"
            :aria-label="t('ui.invoices.notes')"
            :aria-invalid="errors.notes ? 'true' : undefined"
          />
          <p v-if="errors.notes" :class="ERROR">
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ errors.notes }}
          </p>
        </ScreenSection>
        <ScreenSection v-else-if="invoice.notes" :title="t('ui.invoices.notes')">
          <p class="m-0 text-sm whitespace-pre-line">{{ invoice.notes }}</p>
        </ScreenSection>
      </div>
    </EntityScreen>

    <!-- What Save submits (the header's button names it). The lines' inputs
         belong to it (`form`), so Enter in them saves; the body is sent from
         the editor's state. The Item search stays out, so Enter there never saves -->
    <form id="invoice-form" class="hidden" @submit.prevent="save" />

    <!-- Organising again replaces the sections and the Charges' lines (ADR 0018) -->
    <Dialog v-model:open="organiseOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.invoices.organise') }}</DialogTitle>
        <DialogDescription>{{ t('ui.invoices.organiseConfirm') }}</DialogDescription>
        <Form
          v-slot="{ processing: organising }"
          route="invoices.organise"
          :params="{ id: invoice.id }"
          class="flex flex-col gap-4"
          @success="organiseOpen = false"
        >
          <input type="hidden" name="combine" :value="organiseCombine ? 'true' : 'false'" />
          <FormField
            id="organise-by"
            v-slot="field"
            :label="t('ui.invoices.organiseBy')"
            :hint="t('ui.invoices.organiseByHint')"
          >
            <NativeSelect
              :id="field.id"
              v-model="organiseBy"
              name="organiseBy"
              :aria-describedby="field.describedBy"
            >
              <option v-for="option in ORGANISE_BY" :key="option" :value="option">
                {{ t(`ui.invoices.organiseOptions.${option}`) }}
              </option>
            </NativeSelect>
          </FormField>
          <label class="flex min-h-11 items-center gap-2.5 text-sm font-medium md:min-h-0">
            <input v-model="organiseCombine" type="checkbox" class="size-4" />
            {{ t('ui.invoices.combineCharges') }}
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" :class="BUTTON" @click="organiseOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="BUTTON" :disabled="organising">
              {{ t('ui.invoices.organise') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <!-- SDI's outcome for the Submission in progress -->
    <Dialog v-model:open="outcomeOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')" :aria-describedby="undefined">
        <DialogTitle>{{ t('ui.invoices.recordOutcome') }}</DialogTitle>
        <Form
          v-slot="{ processing: recording, errors: outcomeErrors }"
          route="invoices.record_outcome"
          :params="{ id: invoice.id }"
          class="flex flex-col gap-4"
          @success="outcomeOpen = false"
        >
          <FormField id="outcome" v-slot="field" :label="t('ui.invoices.outcome')">
            <NativeSelect :id="field.id" name="outcome">
              <option v-for="code in SUBMISSION_OUTCOMES" :key="code" :value="code">
                {{ t(`ui.invoices.outcomes.${code}`) }}
              </option>
            </NativeSelect>
          </FormField>
          <FormField
            id="notice-on"
            v-slot="field"
            :label="t('ui.invoices.noticeOn')"
            :error="outcomeErrors.noticeOn"
          >
            <Input
              :id="field.id"
              name="noticeOn"
              type="date"
              :default-value="today"
              :max="today"
              :class="FIELD"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <FormField
            id="sdi-id"
            v-slot="field"
            :label="t('ui.invoices.sdiId')"
            :error="outcomeErrors.sdiId"
          >
            <Input
              :id="field.id"
              name="sdiId"
              inputmode="numeric"
              :class="FIELD"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <FormField
            id="outcome-notes"
            v-slot="field"
            :label="t('ui.invoices.outcomeNotes')"
            :hint="t('ui.invoices.outcomeNotesHint')"
            :error="outcomeErrors.notes"
          >
            <Textarea
              :id="field.id"
              name="notes"
              rows="2"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="BUTTON" @click="outcomeOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="BUTTON" :disabled="recording">
              {{ t('ui.invoices.recordOutcome') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <ItemPreview v-model:item-id="previewedItem" />
  </AppLayout>
</template>
