<script setup lang="ts">
/**
 * An Issued Document, an Entity screen under its Customer (docs/ui.md
 * "Hierarchy and references"). It is frozen once issued, so everything
 * shows as text: who and what it was issued for in the key facts, the
 * documents it replaces or that replaced it in their section. Its PDF and
 * issuing a replacement are the header's, as the server declares them.
 */
import { computed } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, t } from '~/i18n'
import type { ScreenAction } from '@shared/screen_actions'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import type { KeyFact } from '~/components/screen/key_facts.vue'
import { LINK } from '~/components/screen/screen'

const props = defineProps<{
  // Its PDF; a replacement while it can have one
  actions: ScreenAction[]
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

const title = computed(() =>
  t('ui.issuedDocuments.showTitle', { name: props.document.title, number: props.document.number })
)
const crumbs = computed(() => [
  { label: t('ui.customers.title'), href: urlFor('customers.index') },
  {
    label: props.document.customer.displayName,
    href: urlFor('customers.show', { id: props.document.customer.id }),
  },
])

const keyFacts = computed<KeyFact[]>(() => {
  const { customer, site, equipment, job } = props.document
  const facts: KeyFact[] = [
    {
      label: t('ui.issuedDocuments.customer'),
      value: customer.displayName,
      href: urlFor('customers.show', { id: customer.id }),
    },
  ]
  if (site) {
    facts.push({
      label: t('ui.issuedDocuments.site'),
      value: site.summary,
      href: urlFor('sites.show', { id: site.id }),
    })
  }
  if (equipment) {
    facts.push({ label: t('ui.issuedDocuments.equipment'), value: equipment.description })
  }
  if (job) {
    facts.push({
      label: t('ui.issuedDocuments.job'),
      value: job.number,
      href: urlFor('jobs.show', { id: job.id }),
      hint: job.title,
    })
  }
  return facts
})

// The documents before and after it, oldest first
const chain = computed(() =>
  [
    props.document.replaces && {
      label: t('ui.issuedDocuments.replaces'),
      ...props.document.replaces,
    },
    props.document.replacedBy && {
      label: t('ui.issuedDocuments.replacedBy'),
      ...props.document.replacedBy,
    },
  ].filter((link) => !!link)
)
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="title"
      :crumbs="crumbs"
      :current="title"
      :title="title"
      :facts="t('ui.issuedDocuments.issuedOnFact', { date: formatDate(document.issuedOn) })"
      :actions="actions"
      :key-facts="keyFacts"
    >
      <template v-if="document.replacedBy" #tags>
        <StatusTag tone="grey">{{ t('ui.issuedDocuments.replaced') }}</StatusTag>
      </template>

      <ScreenSection v-if="chain.length" :title="t('ui.issuedDocuments.replacements')" flush>
        <dl class="m-0">
          <div
            v-for="link in chain"
            :key="link.id"
            class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border px-3.5 py-3 text-sm md:px-4"
          >
            <dt class="text-muted-foreground">{{ link.label }}</dt>
            <dd class="m-0">
              <Link route="issued_documents.show" :params="{ id: link.id }" :class="LINK">
                {{ link.number }}
              </Link>
            </dd>
          </div>
        </dl>
      </ScreenSection>
    </EntityScreen>
  </AppLayout>
</template>
