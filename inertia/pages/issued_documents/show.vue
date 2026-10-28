<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, t } from '~/i18n'

defineProps<{
  document: {
    id: number
    number: string
    title: string
    issuedOn: string
    customer: { id: number; displayName: string }
    site: { id: number; summary: string } | null
    equipment: { id: number; description: string } | null
    job: { id: number; number: string; title: string } | null
    replacedBy: { id: number; number: string } | null
    replaces: { id: number; number: string } | null
    canReplace: boolean
  }
}>()
</script>

<template>
  <AppLayout>
    <Page
      :title="t('ui.issuedDocuments.showTitle', { name: document.title, number: document.number })"
      :description="formatDate(document.issuedOn)"
    >
      <template #actions>
        <a
          :href="urlFor('issued_documents.pdf', { id: document.id })"
          target="_blank"
          rel="noopener"
          class="btn btn--secondary btn--sm"
        >
          {{ t('ui.issuedDocuments.pdf') }}
        </a>
        <Link
          v-if="document.canReplace"
          route="issued_documents.replace"
          :params="{ id: document.id }"
          class="btn btn--ghost btn--sm"
        >
          {{ t('ui.issuedDocuments.replace') }}
        </Link>
      </template>

      <p v-if="document.replacedBy" class="tag">
        {{ t('ui.issuedDocuments.replacedBy') }}
        <Link route="issued_documents.show" :params="{ id: document.replacedBy.id }" class="il">
          {{ document.replacedBy.number }}
        </Link>
      </p>

      <Section :title="t('ui.issuedDocuments.details')">
        <dl class="details">
          <dt>{{ t('ui.issuedDocuments.customer') }}</dt>
          <dd>
            <Link route="customers.show" :params="{ id: document.customer.id }" class="il">
              {{ document.customer.displayName }}
            </Link>
          </dd>
          <template v-if="document.site">
            <dt>{{ t('ui.issuedDocuments.site') }}</dt>
            <dd>
              <Link route="sites.show" :params="{ id: document.site.id }" class="il">
                {{ document.site.summary }}
              </Link>
            </dd>
          </template>
          <template v-if="document.equipment">
            <dt>{{ t('ui.issuedDocuments.equipment') }}</dt>
            <dd>{{ document.equipment.description }}</dd>
          </template>
          <template v-if="document.job">
            <dt>{{ t('ui.issuedDocuments.job') }}</dt>
            <dd>
              <Link route="jobs.show" :params="{ id: document.job.id }" class="il">
                {{ document.job.number }} – {{ document.job.title }}
              </Link>
            </dd>
          </template>
          <template v-if="document.replaces">
            <dt>{{ t('ui.issuedDocuments.replaces') }}</dt>
            <dd>
              <Link route="issued_documents.show" :params="{ id: document.replaces.id }" class="il">
                {{ document.replaces.number }}
              </Link>
            </dd>
          </template>
        </dl>
      </Section>
    </Page>
  </AppLayout>
</template>
