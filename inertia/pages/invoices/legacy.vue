<script setup lang="ts">
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Trash2 } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import CustomerPicker from '~/components/customer_picker.vue'
import InvoicePayments from '~/components/invoice_payments.vue'
import { urlFor } from '~/client'
import { formatDate, formatMoney, t, todayIso } from '~/i18n'
import { amountForInput } from '@shared/money'
import type { AdvanceState } from '@shared/advances'

type VatRow = {
  vatCodeId: number
  vatRate: string
  natura: string | null
  taxable: string
  vat: string
}

const props = defineProps<{
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
  // A Credit Note credits it by amounts (#27)
  canCredit: boolean
  creditNotes: { id: number; number: string | null; status: string; total: string | null }[]
  advanceState: { state: AdvanceState; deducted: string; left: string } | null
  payments: { id: number; amount: string; paidOn: string; note: string | null }[]
  paymentSummary: {
    status: string
    credited: string
    paid: string
    owed: string
    overpaidBy: string | null
  } | null
}>()

const today = todayIso()
const input = (amount: string | undefined) => (amount ? amountForInput(amount) : '')
const advance = ref(props.invoice?.advance ?? false)
const paid = ref(false)
let nextKey = 0
const rows = ref(
  (props.invoice?.vatRows ?? []).map((row) => ({
    key: nextKey++,
    vatCodeId: row.vatCodeId as number | null,
    taxable: input(row.taxable),
  }))
)
const addRow = () => rows.value.push({ key: nextKey++, vatCodeId: null, taxable: '' })
const removeRow = (key: number) => (rows.value = rows.value.filter((row) => row.key !== key))

const title = computed(() =>
  props.invoice
    ? t('ui.legacyInvoices.title', { number: props.invoice.number })
    : t('ui.legacyInvoices.newTitle')
)
const description = computed(() =>
  props.invoice
    ? `${props.invoice.customer.displayName} · ${t('ui.legacyInvoices.description')}`
    : t('ui.legacyInvoices.newDescription')
)
const pickCustomer = (customer: { id: number }) =>
  router.get(urlFor('legacy_invoices.create'), { customerId: customer.id })
const confirmDelete = () => window.confirm(t('ui.legacyInvoices.deleteConfirm'))
</script>

<template>
  <AppLayout>
    <Page :title="title" :description="description">
      <template v-if="invoice" #actions>
        <Form v-if="canCredit" route="invoices.store_credit_note" :params="{ id: invoice.id }">
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.invoices.newCreditNote') }}
          </button>
        </Form>
        <a
          :href="urlFor('legacy_invoices.pdf', { id: invoice.id })"
          target="_blank"
          rel="noopener"
          class="btn btn--secondary btn--sm"
        >
          {{ t('ui.legacyInvoices.openPdf', { name: invoice.pdfName }) }}
        </a>
      </template>

      <Section v-if="!customer" :title="t('ui.legacyInvoices.customer')">
        <CustomerPicker @select="pickCustomer" />
      </Section>

      <template v-else>
        <Section v-if="invoice && !editable" :title="t('ui.legacyInvoices.amounts')">
          <p class="field__hint">{{ t('ui.legacyInvoices.locked') }}</p>
          <dl class="details">
            <dt>{{ t('ui.legacyInvoices.job') }}</dt>
            <dd>
              <Link
                v-if="invoice.job"
                route="jobs.show"
                :params="{ id: invoice.job.id }"
                class="il"
              >
                {{ invoice.job.number }} {{ invoice.job.title }}
              </Link>
              <template v-else>{{ t('ui.legacyInvoices.noJob') }}</template>
            </dd>
            <dt>{{ t('ui.legacyInvoices.issuedOn') }}</dt>
            <dd>{{ formatDate(invoice.issuedOn) }}</dd>
            <dt>{{ t('ui.legacyInvoices.dueOn') }}</dt>
            <dd>{{ formatDate(invoice.dueOn) }}</dd>
            <dt>{{ t('ui.legacyInvoices.taxable') }}</dt>
            <dd>{{ formatMoney(invoice.taxable) }}</dd>
            <dt>{{ t('ui.legacyInvoices.vat') }}</dt>
            <dd>{{ formatMoney(invoice.vat) }}</dd>
            <dt>{{ t('ui.legacyInvoices.total') }}</dt>
            <dd>{{ formatMoney(invoice.total) }}</dd>
          </dl>
          <table v-if="invoice.advance" class="table">
            <thead>
              <tr>
                <th>{{ t('ui.legacyInvoices.vatCode') }}</th>
                <th :style="{ textAlign: 'right' }">{{ t('ui.legacyInvoices.rowTaxable') }}</th>
                <th :style="{ textAlign: 'right' }">{{ t('ui.legacyInvoices.rowVat') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in invoice.vatRows" :key="row.vatCodeId">
                <td>{{ vatCodes.find((code) => code.id === row.vatCodeId)?.name }}</td>
                <td :style="{ textAlign: 'right' }">{{ formatMoney(row.taxable) }}</td>
                <td :style="{ textAlign: 'right' }">{{ formatMoney(row.vat) }}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Form
          v-else
          v-slot="{ processing, errors }"
          :route="invoice ? 'legacy_invoices.update' : 'legacy_invoices.store'"
          :params="invoice ? { id: invoice.id } : undefined"
        >
          <Section :title="t('ui.legacyInvoices.customer')">
            <input type="hidden" name="customerId" :value="customer.id" />
            <p>
              <strong>{{ customer.displayName }}</strong>
            </p>
            <div class="field" :style="{ maxWidth: '420px' }">
              <label class="field__label" for="legacy-job">{{ t('ui.legacyInvoices.job') }}</label>
              <select id="legacy-job" name="jobId" class="field__input">
                <option value="">{{ t('ui.legacyInvoices.noJob') }}</option>
                <option
                  v-for="job in jobs"
                  :key="job.id"
                  :value="job.id"
                  :selected="job.id === jobId"
                >
                  {{ job.number }} {{ job.title }}
                </option>
              </select>
              <span v-if="errors.jobId" class="field__error">{{ errors.jobId }}</span>
            </div>
          </Section>

          <Section :title="t('ui.legacyInvoices.amounts')">
            <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
              <div class="field">
                <label class="field__label" for="legacy-number">
                  {{ t('ui.legacyInvoices.number') }}
                </label>
                <input
                  id="legacy-number"
                  name="number"
                  class="field__input mono"
                  :value="invoice?.number ?? ''"
                />
                <span class="field__hint">{{ t('ui.legacyInvoices.numberHint') }}</span>
                <span v-if="errors.number" class="field__error">{{ errors.number }}</span>
              </div>
              <div class="field">
                <label class="field__label" for="legacy-issued-on">
                  {{ t('ui.legacyInvoices.issuedOn') }}
                </label>
                <input
                  id="legacy-issued-on"
                  name="issuedOn"
                  type="date"
                  :max="today"
                  class="field__input"
                  :value="invoice?.issuedOn ?? ''"
                />
                <span v-if="errors.issuedOn" class="field__error">{{ errors.issuedOn }}</span>
              </div>
              <div class="field">
                <label class="field__label" for="legacy-due-on">
                  {{ t('ui.legacyInvoices.dueOn') }}
                </label>
                <input
                  id="legacy-due-on"
                  name="dueOn"
                  type="date"
                  class="field__input"
                  :value="invoice?.dueOn ?? ''"
                />
                <span class="field__hint">{{ t('ui.legacyInvoices.dueOnHint') }}</span>
                <span v-if="errors.dueOn" class="field__error">{{ errors.dueOn }}</span>
              </div>
            </div>
            <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
              <div class="field">
                <label class="field__label" for="legacy-taxable">
                  {{ t('ui.legacyInvoices.taxable') }}
                </label>
                <input
                  id="legacy-taxable"
                  name="taxable"
                  inputmode="decimal"
                  class="field__input"
                  :value="input(invoice?.taxable)"
                />
                <span v-if="errors.taxable" class="field__error">{{ errors.taxable }}</span>
              </div>
              <div class="field">
                <label class="field__label" for="legacy-vat">{{
                  t('ui.legacyInvoices.vat')
                }}</label>
                <input
                  id="legacy-vat"
                  name="vat"
                  inputmode="decimal"
                  class="field__input"
                  :value="input(invoice?.vat)"
                />
                <span v-if="errors.vat" class="field__error">{{ errors.vat }}</span>
              </div>
              <div class="field">
                <label class="field__label" for="legacy-total">
                  {{ t('ui.legacyInvoices.total') }}
                </label>
                <input
                  id="legacy-total"
                  name="total"
                  inputmode="decimal"
                  class="field__input"
                  :value="input(invoice?.total)"
                />
                <span v-if="errors.total" class="field__error">{{ errors.total }}</span>
              </div>
            </div>
          </Section>

          <Section :title="t('ui.legacyInvoices.vatRows')">
            <label>
              <input v-model="advance" type="checkbox" name="advance" value="1" />
              {{ t('ui.legacyInvoices.advance') }}
            </label>
            <p class="field__hint">{{ t('ui.legacyInvoices.advanceHint') }}</p>
            <template v-if="advance">
              <table v-if="rows.length" class="table">
                <thead>
                  <tr>
                    <th>{{ t('ui.legacyInvoices.vatCode') }}</th>
                    <th>{{ t('ui.legacyInvoices.rowTaxable') }}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in rows" :key="row.key">
                    <td>
                      <select
                        v-model="row.vatCodeId"
                        :name="`vatRows[${index}][vatCodeId]`"
                        class="field__input"
                        :aria-label="t('ui.legacyInvoices.vatCodeOf', { position: index + 1 })"
                      >
                        <option v-for="code in vatCodes" :key="code.id" :value="code.id">
                          {{ code.name }}
                        </option>
                      </select>
                    </td>
                    <td>
                      <input
                        v-model="row.taxable"
                        :name="`vatRows[${index}][taxable]`"
                        inputmode="decimal"
                        class="field__input"
                        :aria-label="t('ui.legacyInvoices.rowTaxableOf', { position: index + 1 })"
                      />
                    </td>
                    <td class="table__actions">
                      <button
                        type="button"
                        class="btn btn--ghost btn--sm"
                        @click="removeRow(row.key)"
                      >
                        {{ t('ui.legacyInvoices.removeRow') }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <button type="button" class="btn btn--secondary btn--sm" @click="addRow">
                {{ t('ui.legacyInvoices.addRow') }}
              </button>
              <span v-if="errors.vatRows" class="field__error">{{ errors.vatRows }}</span>
            </template>
          </Section>

          <Section v-if="!invoice" :title="t('ui.legacyInvoices.paid')">
            <label>
              <input v-model="paid" type="checkbox" name="paid" value="1" />
              {{ t('ui.legacyInvoices.paidHint') }}
            </label>
            <div v-if="paid" class="field" :style="{ maxWidth: '240px' }">
              <label class="field__label" for="legacy-paid-on">
                {{ t('ui.legacyInvoices.paidOn') }}
              </label>
              <input
                id="legacy-paid-on"
                name="paidOn"
                type="date"
                :max="today"
                class="field__input"
              />
              <span class="field__hint">{{ t('ui.legacyInvoices.paidOnHint') }}</span>
              <span v-if="errors.paidOn" class="field__error">{{ errors.paidOn }}</span>
            </div>
          </Section>

          <Section
            :title="invoice ? t('ui.legacyInvoices.pdfReplace') : t('ui.legacyInvoices.pdf')"
          >
            <input
              id="legacy-pdf"
              name="pdf"
              type="file"
              accept=".pdf"
              :aria-label="t('ui.legacyInvoices.pdf')"
            />
            <span v-if="errors.pdf" class="field__error">{{ errors.pdf }}</span>
          </Section>

          <Section>
            <button type="submit" class="btn btn--primary" :disabled="processing">
              {{ invoice ? t('ui.legacyInvoices.save') : t('ui.legacyInvoices.create') }}
            </button>
          </Section>
        </Form>

        <Section v-if="advanceState">
          <p data-testid="advance-state">
            {{
              t('ui.legacyInvoices.advanceState', {
                state: t(`ui.invoices.advanceStates.${advanceState.state}`, {
                  amount: formatMoney(advanceState.deducted),
                }),
                left: formatMoney(advanceState.left),
              })
            }}
          </p>
        </Section>

        <Section v-if="creditNotes.length" :title="t('ui.invoices.creditNotesTitle')">
          <table class="table">
            <tbody>
              <tr v-for="note in creditNotes" :key="note.id">
                <td>
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
          v-if="invoice && paymentSummary"
          :invoice-id="invoice.id"
          :payments="payments"
          :summary="paymentSummary"
        />

        <Section v-if="invoice && editable">
          <Form
            route="legacy_invoices.destroy"
            :params="{ id: invoice.id }"
            :on-before="confirmDelete"
          >
            <button type="submit" class="btn btn--ghost btn--sm">
              <Trash2 :size="14" /> {{ t('ui.legacyInvoices.delete') }}
            </button>
          </Form>
        </Section>
      </template>
    </Page>
  </AppLayout>
</template>
