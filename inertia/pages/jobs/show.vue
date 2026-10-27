<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import { Pencil } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, t } from '~/i18n'

const confirm = (message: string) => window.confirm(message)

defineProps<{
  job: {
    id: number
    number: string
    title: string
    kind: string
    status: string
    description: string | null
    customer: { id: number; displayName: string } | null
    site: { id: number; summary: string } | null
    createdAt: string
    cancelledAt: string | null
  }
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
