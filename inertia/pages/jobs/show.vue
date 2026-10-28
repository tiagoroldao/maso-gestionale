<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import { Pencil } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, formatMoney, t } from '~/i18n'
import { urlFor } from '~/client'
import { amountForInput } from '@shared/money'
import type { ChargeState } from '@shared/charges'
import { LINE_KINDS } from '@shared/vat'
import { ref } from 'vue'

const confirm = (message: string) => window.confirm(message)
// The new cost's fields, pre-filled with the call-out fee on request
const blankCharge = () => ({
  description: '',
  quantity: '1',
  unit: '',
  unitPrice: '',
  vatKind: 'labour',
})
const newCharge = ref(blankCharge())
function fillCallOut(fee: string) {
  newCharge.value = {
    ...blankCharge(),
    description: t('ui.charges.callOut'),
    unitPrice: amountForInput(fee),
  }
}
const quantity = (value: string) => amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')

defineProps<{
  invoices: { id: number; number: string | null; status: string; total: string; advance: boolean }[]
  canInvoice: boolean
  canInvoiceAdvance: boolean
  invoicedSoFar: { amount: string; of: string | null }
  timeAndMaterials: { total: string; billed: string; lines: number }
  callOutFee: string | null
  charges: {
    id: number
    visitId: number | null
    description: string
    unit: string | null
    quantity: string
    unitPrice: string
    amount: string
    state: ChargeState
  }[]
  job: {
    id: number
    number: string
    title: string
    kind: string
    workCategory: string
    status: string
    description: string | null
    customer: { id: number; displayName: string } | null
    site: { id: number; summary: string } | null
    createdAt: string
    cancelledAt: string | null
  }
  visits: {
    id: number
    startsAt: string
    endsAt: string
    status: string
    technicians: string[]
    notes: { id: number; body: string; author: string | null }[]
    photoIds: number[]
  }[]
}>()
</script>

<template>
  <AppLayout>
    <Page :title="`${job.number} · ${job.title}`">
      <template #actions>
        <Link
          v-if="job.status !== 'cancelled'"
          route="jobs.edit"
          :params="{ id: job.id }"
          class="btn btn--secondary btn--sm"
        >
          <Pencil :size="15" /> {{ t('ui.common.edit') }}
        </Link>
      </template>

      <Section :title="t('ui.jobs.detailsSection')">
        <dl class="details">
          <dt>{{ t('ui.jobs.status') }}</dt>
          <dd>
            <span class="tag">{{ t(`ui.jobs.statuses.${job.status}`) }}</span>
            <span v-if="job.cancelledAt" class="field__hint">
              · {{ t('ui.jobs.cancelledOn', { date: formatDate(job.cancelledAt) }) }}
            </span>
          </dd>
          <dt>{{ t('ui.jobs.kind') }}</dt>
          <dd>{{ t(`ui.jobs.kinds.${job.kind}`) }}</dd>
          <dt>{{ t('ui.jobs.workCategory') }}</dt>
          <dd>{{ t(`ui.jobs.workCategories.${job.workCategory}`) }}</dd>
          <dt>{{ t('ui.jobs.customer') }}</dt>
          <dd>
            <Link
              v-if="job.customer"
              route="customers.show"
              :params="{ id: job.customer.id }"
              class="il"
            >
              {{ job.customer.displayName }}
            </Link>
          </dd>
          <template v-if="job.site">
            <dt>{{ t('ui.jobs.site') }}</dt>
            <dd>
              <Link route="sites.show" :params="{ id: job.site.id }" class="il">
                {{ job.site.summary }}
              </Link>
            </dd>
          </template>
          <dt>{{ t('ui.jobs.createdAt') }}</dt>
          <dd>{{ formatDate(job.createdAt) }}</dd>
          <template v-if="job.description">
            <dt>{{ t('ui.jobs.description') }}</dt>
            <dd :style="{ whiteSpace: 'pre-line' }">{{ job.description }}</dd>
          </template>
        </dl>
      </Section>

      <Section v-if="timeAndMaterials.lines" :title="t('ui.jobs.timeAndMaterials')">
        <p :style="{ margin: 0 }">
          <strong>{{ formatMoney(timeAndMaterials.total) }}</strong>
          <span class="field__hint"> · {{ t('ui.jobs.timeAndMaterialsHint') }}</span>
        </p>
        <p v-if="job.kind === 'time_and_materials'" :style="{ margin: 0 }" data-testid="billed">
          {{ t('ui.jobs.billed', { amount: formatMoney(timeAndMaterials.billed) }) }}
        </p>
      </Section>

      <Section :title="t('ui.visits.title')">
        <table v-if="visits.length" class="table">
          <tbody>
            <tr v-for="visit in visits" :key="visit.id">
              <td>
                <Link
                  route="visits.schedule"
                  :qs="{ date: visit.startsAt.slice(0, 10) }"
                  class="il"
                >
                  {{ formatDate(visit.startsAt) }} {{ visit.startsAt.slice(11, 16) }}–{{
                    visit.endsAt.slice(11, 16)
                  }}
                </Link>
                <Link route="visits.edit" :params="{ id: visit.id }" class="btn btn--ghost btn--sm">
                  {{ t('ui.visits.edit') }}
                </Link>
              </td>
              <td>
                {{ visit.technicians.join(', ') }}
                <div v-for="note in visit.notes" :key="note.id" class="field__hint">
                  {{ note.author }}: {{ note.body }}
                </div>
                <div v-if="visit.photoIds.length" class="field-photos">
                  <a
                    v-for="photoId in visit.photoIds"
                    :key="photoId"
                    :href="urlFor('visit_photos.show', { id: photoId })"
                    target="_blank"
                    rel="noopener"
                  >
                    <img
                      :src="urlFor('visit_photos.show', { id: photoId })"
                      :alt="t('ui.field.photo')"
                      loading="lazy"
                    />
                  </a>
                </div>
              </td>
              <td>
                <span class="tag">{{ t(`ui.visits.statuses.${visit.status}`) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.visits.none') }}</p>
        <div v-if="job.status !== 'cancelled'">
          <Link route="visits.create" :params="{ id: job.id }" class="btn btn--secondary btn--sm">
            {{ t('ui.visits.plan') }}
          </Link>
        </div>
      </Section>

      <Section :title="t('ui.charges.title')">
        <table v-if="charges.length" class="table" data-testid="charges">
          <thead>
            <tr>
              <th>{{ t('ui.charges.description') }}</th>
              <th>{{ t('ui.charges.quantity') }}</th>
              <th>{{ t('ui.charges.unitPrice') }}</th>
              <th>{{ t('ui.charges.amount') }}</th>
              <th>{{ t('ui.charges.state') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="charge in charges" :key="charge.id">
              <td>
                {{ charge.description }}
                <div class="field__hint">
                  {{
                    charge.visitId
                      ? t('ui.charges.visit', {
                          date: formatDate(
                            visits.find((visit) => visit.id === charge.visitId)?.startsAt ?? ''
                          ),
                        })
                      : t('ui.charges.onJob')
                  }}
                </div>
              </td>
              <td>{{ quantity(charge.quantity) }} {{ charge.unit }}</td>
              <td>{{ formatMoney(charge.unitPrice) }}</td>
              <td>{{ formatMoney(charge.amount) }}</td>
              <td>
                <span class="tag">{{ t(`ui.charges.states.${charge.state}`) }}</span>
              </td>
              <td class="table__actions">
                <Link
                  route="charges.edit"
                  :params="{ id: charge.id }"
                  class="btn btn--ghost btn--sm"
                >
                  {{ t('ui.charges.open') }}
                </Link>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.charges.none') }}</p>
        <Form
          v-if="job.status !== 'cancelled'"
          v-slot="{ processing, errors }"
          route="charges.store"
          :params="{ id: job.id }"
          class="form"
          @success="newCharge = blankCharge()"
        >
          <p class="field__hint" :style="{ margin: 0 }">
            {{ t('ui.charges.addHint') }}
            <button
              v-if="callOutFee"
              type="button"
              class="btn btn--ghost btn--sm"
              @click="fillCallOut(callOutFee)"
            >
              {{ t('ui.charges.useCallOut') }}
            </button>
          </p>
          <div class="field">
            <label class="field__label" for="new-charge-description">{{
              t('ui.charges.description')
            }}</label>
            <input
              id="new-charge-description"
              v-model="newCharge.description"
              name="description"
              class="field__input"
            />
            <span v-if="errors.description" class="field__error">{{ errors.description }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-charge-quantity">{{
              t('ui.charges.quantity')
            }}</label>
            <input
              id="new-charge-quantity"
              v-model="newCharge.quantity"
              name="quantity"
              inputmode="decimal"
              class="field__input"
            />
            <span v-if="errors.quantity" class="field__error">{{ errors.quantity }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-charge-unit">{{ t('ui.charges.unit') }}</label>
            <input id="new-charge-unit" v-model="newCharge.unit" name="unit" class="field__input" />
            <span v-if="errors.unit" class="field__error">{{ errors.unit }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-charge-price">{{
              t('ui.charges.unitPrice')
            }}</label>
            <input
              id="new-charge-price"
              v-model="newCharge.unitPrice"
              name="unitPrice"
              inputmode="decimal"
              class="field__input"
            />
            <span v-if="errors.unitPrice" class="field__error">{{ errors.unitPrice }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-charge-vat">{{ t('ui.charges.vatKind') }}</label>
            <select
              id="new-charge-vat"
              v-model="newCharge.vatKind"
              name="vatKind"
              class="field__input"
            >
              <option v-for="kind in LINE_KINDS" :key="kind" :value="kind">
                {{ t(`ui.charges.vatKinds.${kind}`) }}
              </option>
            </select>
            <span v-if="errors.vatKind" class="field__error">{{ errors.vatKind }}</span>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
            {{ t('ui.charges.add') }}
          </button>
        </Form>
      </Section>

      <Section v-if="job.kind === 'quoted'" :title="t('ui.quotes.section')">
        <Link route="quotes.edit" :params="{ id: job.id }" class="btn btn--secondary btn--sm">
          {{ job.status === 'open' ? t('ui.quotes.write') : t('ui.quotes.open') }}
        </Link>
      </Section>

      <Section
        v-if="invoices.length || canInvoice || canInvoiceAdvance"
        :title="t('ui.invoices.title')"
      >
        <p v-if="invoices.length" :style="{ margin: '0 0 8px' }" data-testid="invoiced-so-far">
          {{
            invoicedSoFar.of
              ? t('ui.invoices.invoicedSoFarOf', {
                  amount: formatMoney(invoicedSoFar.amount),
                  of: formatMoney(invoicedSoFar.of),
                })
              : t('ui.invoices.invoicedSoFar', { amount: formatMoney(invoicedSoFar.amount) })
          }}
        </p>
        <ul v-if="invoices.length" :style="{ margin: 0, paddingLeft: '18px' }">
          <li v-for="invoice in invoices" :key="invoice.id">
            <Link route="invoices.edit" :params="{ id: invoice.id }" class="il">
              {{ invoice.number ?? t('ui.invoices.statuses.draft') }}
            </Link>
            <span v-if="invoice.advance"> · {{ t('ui.invoices.advance') }}</span>
            · {{ t(`ui.invoices.statuses.${invoice.status}`) }} · {{ formatMoney(invoice.total) }}
          </li>
        </ul>
        <Form
          v-if="canInvoiceAdvance"
          route="invoices.store_advance"
          :params="{ id: job.id }"
          :style="{ marginBottom: '8px' }"
        >
          <button type="submit" class="btn btn--ghost btn--sm">
            {{ t('ui.invoices.newAdvance') }}
          </button>
        </Form>
        <Form v-if="canInvoice" route="invoices.store_from_job" :params="{ id: job.id }">
          <button type="submit" class="btn btn--secondary btn--sm">
            {{
              job.kind === 'quoted'
                ? t('ui.invoices.fromQuote')
                : t('ui.invoices.fromTimeAndMaterials')
            }}
          </button>
        </Form>
      </Section>

      <Section v-if="job.status !== 'cancelled'">
        <Form
          route="jobs.cancel"
          :params="{ id: job.id }"
          :on-before="() => confirm(t('ui.jobs.cancelConfirm', { number: job.number }))"
        >
          <button type="submit" class="btn btn--ghost btn--sm">{{ t('ui.jobs.cancel') }}</button>
        </Form>
      </Section>
    </Page>
  </AppLayout>
</template>
