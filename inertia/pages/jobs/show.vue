<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import { Pencil } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, formatMoney, t } from '~/i18n'
import { urlFor } from '~/client'

const confirm = (message: string) => window.confirm(message)

defineProps<{
  invoices: { id: number; number: string | null; status: string; total: string }[]
  canInvoiceFromQuote: boolean
  timeAndMaterials: { total: string; lines: number }
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

      <Section v-if="job.kind === 'quoted'" :title="t('ui.quotes.section')">
        <Link route="quotes.edit" :params="{ id: job.id }" class="btn btn--secondary btn--sm">
          {{ job.status === 'open' ? t('ui.quotes.write') : t('ui.quotes.open') }}
        </Link>
      </Section>

      <Section v-if="invoices.length || canInvoiceFromQuote" :title="t('ui.invoices.title')">
        <ul v-if="invoices.length" :style="{ margin: 0, paddingLeft: '18px' }">
          <li v-for="invoice in invoices" :key="invoice.id">
            <Link route="invoices.edit" :params="{ id: invoice.id }" class="il">
              {{ invoice.number ?? t('ui.invoices.statuses.draft') }}
            </Link>
            · {{ t(`ui.invoices.statuses.${invoice.status}`) }} · {{ formatMoney(invoice.total) }}
          </li>
        </ul>
        <Form v-if="canInvoiceFromQuote" route="invoices.store_from_job" :params="{ id: job.id }">
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.invoices.fromQuote') }}
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
