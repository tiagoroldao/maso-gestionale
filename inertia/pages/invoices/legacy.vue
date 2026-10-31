<script setup lang="ts">
/**
 * A Legacy Invoice (#27), an Entity screen on the new UI (docs/ui.md): an
 * invoice the previous software issued, kept as its totals and original
 * PDF. A new one starts from its Customer (picked here unless the page was
 * opened for a Customer or a Job), then is entered in edit mode, Save its
 * primary. A saved one is edited in place on its own screen while nothing
 * depends on it, its VAT rows (an advance's) edited in their rows; once it
 * has Payments, deductions or Credit Notes it reads as text. Its header
 * actions come from the server; its Credit Notes and Payments follow.
 */
import { computed, reactive, ref, watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { CircleAlert, Trash2 } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import CustomerPicker from '~/components/customer_picker.vue'
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
import { EMPTY, INVOICE_TONES, LABEL, LINK, ROW, TOUCH } from '~/components/screen/screen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import { urlFor } from '~/client'
import { cn } from '~/lib/utils'
import { formatMoney, t, todayIso } from '~/i18n'
import { formatDate } from '@shared/dates'
import { amountForInput } from '@shared/money'
import type { AdvanceState } from '@shared/advances'
import type { InvoiceStatus } from '@shared/invoice_lifecycle'
import type { PaymentStatus } from '@shared/payment_status'
import type { ScreenAction } from '@shared/screen_actions'

type VatRow = {
  vatCodeId: number
  vatRate: string
  natura: string | null
  taxable: string
  vat: string
}

const props = defineProps<{
  // The header's actions, for its state: Save while it can change
  actions: ScreenAction[]
  // Null for a new Legacy Invoice
  invoice: {
    id: number
    number: string
    issuedOn: string
    dueOn: string
    customer: { id: number; displayName: string }
    job: { id: number; number: string; title: string } | null
    taxable: string
    vat: string
    total: string
    advance: boolean
    vatRows: VatRow[]
    pdfName: string
  } | null
  customer: { id: number; displayName: string } | null
  jobId: number | null
  // The Customer's Jobs to pick from
  jobs: { id: number; number: string; title: string }[]
  vatCodes: { id: number; name: string; rate: string }[]
  // Changed or deleted only while it has no Payments and no Invoice takes it back
  editable: boolean
  creditNotes: { id: number; number: string | null; status: InvoiceStatus; total: string | null }[]
  advanceState: { state: AdvanceState; deducted: string; left: string } | null
  payments: { id: number; amount: string; paidOn: string; note: string | null }[]
  paymentSummary: {
    status: PaymentStatus
    credited: string
    paid: string
    owed: string
    overpaidBy: string | null
  } | null
}>()

const page = usePage()
const errors = computed(() => (page.props.errors ?? {}) as Record<string, string>)

// The form Save submits (`LEGACY_INVOICE_FORM` on the server): the fields
// sit in the screen's sections and name it
const FORM = 'legacy-invoice-form'
const today = todayIso()
const input = (amount: string | undefined) => (amount ? amountForInput(amount) : '')

let nextKey = 0
type Row = { key: number; vatCodeId: string; taxable: string }
const rowsFromProps = (): Row[] =>
  (props.invoice?.vatRows ?? []).map((row) => ({
    key: nextKey++,
    vatCodeId: String(row.vatCodeId),
    taxable: input(row.taxable),
  }))

/**
 * The fields' values live in reactive state, so a refused save (the page
 * reused, its errors shown) keeps what was typed.
 */
const valuesFromProps = () => ({
  jobId: String(props.invoice ? (props.invoice.job?.id ?? '') : (props.jobId ?? '')),
  number: props.invoice?.number ?? '',
  issuedOn: props.invoice?.issuedOn ?? '',
  dueOn: props.invoice?.dueOn ?? '',
  taxable: input(props.invoice?.taxable),
  vat: input(props.invoice?.vat),
  total: input(props.invoice?.total),
  advance: props.invoice?.advance ?? false,
  paid: false,
  paidOn: '',
})
const values = reactive(valuesFromProps())
const rows = ref(rowsFromProps())
/**
 * Bumped after a save to remount the PDF's file input: the page stays, and
 * a PDF still chosen there would be uploaded again by the next Save (#287).
 */
const pdfInput = ref(0)

// After a save, show what the server has. A refused one keeps what was
// typed: its fields' errors, or the service's refusal as a flash (#290)
watch(
  () => props.invoice,
  () => {
    if (Object.keys(errors.value).length || page.flash.error) return
    Object.assign(values, valuesFromProps())
    rows.value = rowsFromProps()
    rowErrors.reset()
    pdfInput.value++
  }
)

const addRow = () =>
  rows.value.push({ key: nextKey++, vatCodeId: String(props.vatCodes[0]?.id ?? ''), taxable: '' })
const removeRow = (key: number) => (rows.value = rows.value.filter((row) => row.key !== key))

const pickCustomer = (customer: { id: number }) =>
  router.get(urlFor('legacy_invoices.create'), { customerId: customer.id })

const processing = ref(false)

/**
 * Sends the form's fields as they are, the PDF with them; the server
 * answers with the saved invoice's page, or the fields' errors.
 */
function save(event: Event) {
  if (processing.value) return
  rowErrors.send()
  const url = props.invoice
    ? urlFor('legacy_invoices.update', { id: props.invoice.id })
    : urlFor('legacy_invoices.store')
  router.post(url, new FormData(event.target as HTMLFormElement), {
    preserveScroll: true,
    onStart: () => (processing.value = true),
    onFinish: () => (processing.value = false),
    // Without an answer, the errors on screen stay those of the last one
    onCancel: rowErrors.cancel,
    onNetworkError: rowErrors.cancel,
    onHttpException: rowErrors.cancel,
  })
}
// The form is there once the Customer is known, and while the invoice can change
const editing = computed(() => props.customer !== null && props.editable)

const title = computed(() =>
  props.invoice
    ? t('ui.legacyInvoices.title', { number: props.invoice.number })
    : t('ui.legacyInvoices.newTitle')
)
const facts = computed(() =>
  props.invoice
    ? [
        t(`ui.invoices.kinds.${props.invoice.advance ? 'advance' : 'invoice'}`),
        t('ui.invoices.issuedOn', { date: formatDate(props.invoice.issuedOn) }),
        t('ui.invoices.dueOn', { date: formatDate(props.invoice.dueOn) }),
      ].join(' · ')
    : ''
)
const keyFacts = computed<KeyFact[]>(() => {
  const { invoice, customer, paymentSummary } = props
  if (!customer) return []
  const customerFact = {
    label: t('ui.invoices.customer'),
    value: customer.displayName,
    href: urlFor('customers.show', { id: customer.id }),
  }
  if (!invoice) return [customerFact]
  return [
    customerFact,
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
      value: formatMoney(invoice.total),
      amount: true,
      hint: t('ui.invoices.totalHint', {
        taxable: formatMoney(invoice.taxable),
        vat: formatMoney(invoice.vat),
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

const codeName = (id: number) => props.vatCodes.find((code) => code.id === id)?.name ?? ''

/**
 * A VAT row: on the phone its fields stack, each named above it; from
 * 768px one row under the column heads (`RowField`, `RowHeads`, #226).
 */
const VAT_ROW =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 border-t border-border px-3.5 py-3 md:flex md:flex-wrap md:items-start md:gap-x-2 md:px-4'
const CODE = 'md:w-48'
const TAXABLE = 'md:w-36'
const VAT = 'md:w-36 md:text-right'
const editHeads = computed(() => [
  { label: t('ui.legacyInvoices.vatCode'), class: CODE },
  { label: t('ui.legacyInvoices.rowTaxable'), class: TAXABLE },
])
const readHeads = computed(() => [
  ...editHeads.value,
  { label: t('ui.legacyInvoices.rowVat'), class: VAT },
])
const ROW_FIELDS = computed(() => ({
  vatCodeId: t('ui.legacyInvoices.vatCode'),
  taxable: t('ui.legacyInvoices.rowTaxable'),
}))
// Each stays on its row when one is removed or added after a refused save
const rowErrors = useSentRowErrors({
  rows: () => rows.value,
  errors,
  name: 'vatRows',
  fields: Object.keys(ROW_FIELDS.value),
})

const GRID = 'grid gap-4 md:grid-cols-3'
const CHECK = 'flex min-h-11 items-center gap-2.5 text-sm font-medium md:min-h-0'
const HINT = 'm-0 text-[13px] text-muted-foreground'
const ERROR = 'm-0 flex items-start gap-1.5 text-sm text-destructive'
const DT = cn(LABEL, 'text-[10px]')
const READ = 'text-sm md:inline-flex md:min-h-9 md:items-center'
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="title"
      :crumbs="[{ label: t('ui.invoices.title'), href: urlFor('invoices.index') }]"
      :current="invoice?.number ?? title"
      :title="title"
      :facts="facts"
      :actions="actions"
      :key-facts="keyFacts"
      :busy="processing"
    >
      <template v-if="invoice" #tags>
        <StatusTag tone="grey">{{ t('ui.invoices.legacy') }}</StatusTag>
      </template>

      <!-- A new one: its Customer first -->
      <ScreenSection
        v-if="!customer"
        :title="t('ui.legacyInvoices.customer')"
        :description="t('ui.legacyInvoices.newDescription')"
      >
        <CustomerPicker @select="pickCustomer" />
      </ScreenSection>

      <template v-if="customer" #main>
        <ScreenSection
          :title="t('ui.legacyInvoices.details')"
          :description="
            invoice ? t('ui.legacyInvoices.description') : t('ui.legacyInvoices.newDescription')
          "
        >
          <template v-if="editing">
            <input type="hidden" name="customerId" :value="customer.id" :form="FORM" />
            <FormField
              id="legacy-job"
              v-slot="field"
              :label="t('ui.legacyInvoices.job')"
              :error="errors.jobId"
            >
              <NativeSelect
                :id="field.id"
                v-model="values.jobId"
                name="jobId"
                :form="FORM"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              >
                <option value="">{{ t('ui.legacyInvoices.noJob') }}</option>
                <option v-for="job in jobs" :key="job.id" :value="String(job.id)">
                  {{ job.number }} {{ job.title }}
                </option>
              </NativeSelect>
            </FormField>
            <div :class="GRID">
              <FormField
                id="legacy-number"
                v-slot="field"
                :label="t('ui.legacyInvoices.number')"
                :hint="t('ui.legacyInvoices.numberHint')"
                :error="errors.number"
              >
                <Input
                  :id="field.id"
                  v-model="values.number"
                  name="number"
                  :form="FORM"
                  :class="cn(TOUCH, 'font-mono')"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="legacy-issued-on"
                v-slot="field"
                :label="t('ui.legacyInvoices.issuedOn')"
                :error="errors.issuedOn"
              >
                <Input
                  :id="field.id"
                  v-model="values.issuedOn"
                  name="issuedOn"
                  type="date"
                  :max="today"
                  :form="FORM"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="legacy-due-on"
                v-slot="field"
                :label="t('ui.legacyInvoices.dueOn')"
                :hint="t('ui.legacyInvoices.dueOnHint')"
                :error="errors.dueOn"
              >
                <Input
                  :id="field.id"
                  v-model="values.dueOn"
                  name="dueOn"
                  type="date"
                  :form="FORM"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="legacy-taxable"
                v-slot="field"
                :label="t('ui.legacyInvoices.taxable')"
                :error="errors.taxable"
              >
                <Input
                  :id="field.id"
                  v-model="values.taxable"
                  name="taxable"
                  inputmode="decimal"
                  :form="FORM"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="legacy-vat"
                v-slot="field"
                :label="t('ui.legacyInvoices.vat')"
                :error="errors.vat"
              >
                <Input
                  :id="field.id"
                  v-model="values.vat"
                  name="vat"
                  inputmode="decimal"
                  :form="FORM"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="legacy-total"
                v-slot="field"
                :label="t('ui.legacyInvoices.total')"
                :error="errors.total"
              >
                <Input
                  :id="field.id"
                  v-model="values.total"
                  name="total"
                  inputmode="decimal"
                  :form="FORM"
                  :class="TOUCH"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </div>
          </template>

          <!-- Frozen: its values as text, in the fields' places -->
          <template v-else-if="invoice">
            <p :class="HINT">{{ t('ui.legacyInvoices.locked') }}</p>
            <dl
              class="m-0 grid grid-cols-2 gap-4 text-sm md:grid-cols-3"
              data-testid="legacy-amounts"
            >
              <div class="col-span-2 flex flex-col gap-0.5 md:col-span-3">
                <dt :class="DT">{{ t('ui.legacyInvoices.job') }}</dt>
                <dd class="m-0">
                  <Link
                    v-if="invoice.job"
                    route="jobs.show"
                    :params="{ id: invoice.job.id }"
                    :class="LINK"
                  >
                    {{ invoice.job.number }} {{ invoice.job.title }}
                  </Link>
                  <template v-else>{{ t('ui.legacyInvoices.noJob') }}</template>
                </dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt :class="DT">{{ t('ui.legacyInvoices.number') }}</dt>
                <dd class="m-0 font-mono">{{ invoice.number }}</dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt :class="DT">{{ t('ui.legacyInvoices.issuedOn') }}</dt>
                <dd class="m-0">{{ formatDate(invoice.issuedOn) }}</dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt :class="DT">{{ t('ui.legacyInvoices.dueOn') }}</dt>
                <dd class="m-0">{{ formatDate(invoice.dueOn) }}</dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt :class="DT">{{ t('ui.legacyInvoices.taxable') }}</dt>
                <dd class="m-0">{{ formatMoney(invoice.taxable) }}</dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt :class="DT">{{ t('ui.legacyInvoices.vat') }}</dt>
                <dd class="m-0">{{ formatMoney(invoice.vat) }}</dd>
              </div>
              <div class="flex flex-col gap-0.5">
                <dt :class="DT">{{ t('ui.legacyInvoices.total') }}</dt>
                <dd class="m-0 font-semibold">{{ formatMoney(invoice.total) }}</dd>
              </div>
            </dl>
          </template>
        </ScreenSection>

        <!-- An advance's VAT rows, as on its PDF: later Invoices take them back -->
        <ScreenSection
          v-if="editing || invoice?.advance"
          :title="t('ui.legacyInvoices.vatRows')"
          flush
        >
          <template v-if="editing && values.advance" #actions>
            <Button type="button" variant="outline" :class="TOUCH" @click="addRow">
              {{ t('ui.legacyInvoices.addRow') }}
            </Button>
          </template>
          <div class="flex flex-col gap-1.5 px-3.5 pb-3 md:px-4">
            <label v-if="editing" :class="CHECK">
              <input
                v-model="values.advance"
                type="checkbox"
                name="advance"
                value="1"
                :form="FORM"
                class="size-4"
              />
              {{ t('ui.legacyInvoices.advance') }}
            </label>
            <p v-if="editing" :class="HINT">{{ t('ui.legacyInvoices.advanceHint') }}</p>
            <p v-if="advanceState" class="m-0 text-sm" data-testid="advance-state">
              {{
                t('ui.legacyInvoices.advanceState', {
                  state: t(`ui.invoices.advanceStates.${advanceState.state}`, {
                    amount: formatMoney(advanceState.deducted),
                  }),
                  left: formatMoney(advanceState.left),
                })
              }}
            </p>
          </div>

          <template v-if="editing && values.advance">
            <template v-if="rows.length">
              <RowHeads :heads="editHeads" />
              <ol class="m-0 list-none p-0">
                <li
                  v-for="(row, index) in rows"
                  :key="row.key"
                  :class="VAT_ROW"
                  :aria-label="t('ui.legacyInvoices.rowOf', { position: index + 1 })"
                >
                  <RowField :label="t('ui.legacyInvoices.vatCode')" :class="CODE">
                    <NativeSelect
                      v-model="row.vatCodeId"
                      :name="`vatRows[${index}][vatCodeId]`"
                      :form="FORM"
                      :aria-label="t('ui.legacyInvoices.vatCodeOf', { position: index + 1 })"
                      :aria-invalid="rowErrors.invalid(row.key, 'vatCodeId')"
                    >
                      <option v-for="code in vatCodes" :key="code.id" :value="String(code.id)">
                        {{ code.name }}
                      </option>
                    </NativeSelect>
                  </RowField>
                  <RowField :label="t('ui.legacyInvoices.rowTaxable')" :class="TAXABLE">
                    <Input
                      v-model="row.taxable"
                      :name="`vatRows[${index}][taxable]`"
                      inputmode="decimal"
                      :form="FORM"
                      :class="TOUCH"
                      :aria-label="t('ui.legacyInvoices.rowTaxableOf', { position: index + 1 })"
                      :aria-invalid="rowErrors.invalid(row.key, 'taxable')"
                    />
                  </RowField>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-touch"
                    class="md:ml-auto md:size-9"
                    :aria-label="t('ui.legacyInvoices.removeRowOf', { position: index + 1 })"
                    @click="removeRow(row.key)"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                  <div
                    v-if="Object.keys(rowErrors.errorsOf(row.key)).length"
                    class="col-span-full flex flex-col gap-1 md:basis-full"
                  >
                    <RowErrors :errors="rowErrors.errorsOf(row.key)" :fields="ROW_FIELDS" />
                  </div>
                </li>
              </ol>
            </template>
            <p v-else :class="EMPTY">{{ t('ui.legacyInvoices.noRows') }}</p>
            <p
              v-if="errors.vatRows"
              :class="cn(ERROR, 'border-t border-border px-3.5 py-3 md:px-4')"
            >
              <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
              {{ errors.vatRows }}
            </p>
          </template>

          <!-- Frozen: the rows as text -->
          <template v-else-if="!editing && invoice?.advance">
            <RowHeads :heads="readHeads" />
            <ol class="m-0 list-none p-0" data-testid="legacy-vat-rows">
              <li v-for="row in invoice.vatRows" :key="row.vatCodeId" :class="VAT_ROW">
                <RowField :label="t('ui.legacyInvoices.vatCode')" :class="CODE">
                  <span :class="READ">{{ codeName(row.vatCodeId) }}</span>
                </RowField>
                <RowField :label="t('ui.legacyInvoices.rowTaxable')" :class="TAXABLE">
                  <span :class="READ">{{ formatMoney(row.taxable) }}</span>
                </RowField>
                <RowField :label="t('ui.legacyInvoices.rowVat')" :class="cn(VAT, 'md:items-end')">
                  <span :class="READ">{{ formatMoney(row.vat) }}</span>
                </RowField>
              </li>
            </ol>
          </template>
        </ScreenSection>
      </template>

      <template v-if="customer" #side>
        <template v-if="editing">
          <!-- A new one already paid: one Payment for its total -->
          <ScreenSection v-if="!invoice" :title="t('ui.legacyInvoices.paid')">
            <label :class="CHECK">
              <input
                v-model="values.paid"
                type="checkbox"
                name="paid"
                value="1"
                :form="FORM"
                class="size-4"
              />
              {{ t('ui.legacyInvoices.paidHint') }}
            </label>
            <FormField
              v-if="values.paid"
              id="legacy-paid-on"
              v-slot="field"
              :label="t('ui.legacyInvoices.paidOn')"
              :hint="t('ui.legacyInvoices.paidOnHint')"
              :error="errors.paidOn"
            >
              <Input
                :id="field.id"
                v-model="values.paidOn"
                name="paidOn"
                type="date"
                :max="today"
                :form="FORM"
                :class="TOUCH"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </ScreenSection>

          <ScreenSection :title="t('ui.legacyInvoices.pdfSection')">
            <FormField
              id="legacy-pdf"
              v-slot="field"
              :label="invoice ? t('ui.legacyInvoices.pdfReplace') : t('ui.legacyInvoices.pdf')"
              :hint="
                invoice ? t('ui.legacyInvoices.pdfKept', { name: invoice.pdfName }) : undefined
              "
              :error="errors.pdf"
            >
              <Input
                :id="field.id"
                :key="pdfInput"
                name="pdf"
                type="file"
                accept=".pdf"
                :form="FORM"
                :class="cn(TOUCH, 'py-2 md:py-1')"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </ScreenSection>
        </template>

        <InvoicePayments
          v-if="invoice && paymentSummary"
          :invoice-id="invoice.id"
          :payments="payments"
          :summary="paymentSummary"
        />

        <ScreenSection v-if="creditNotes.length" :title="t('ui.invoices.creditNotesTitle')" flush>
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
      </template>
    </EntityScreen>

    <!-- What Save submits (the header's button names it). The fields name it
         too (`form`), so Enter in them saves; the Customer search stays out -->
    <form v-if="editing" :id="FORM" class="hidden" @submit.prevent="save" />
  </AppLayout>
</template>
