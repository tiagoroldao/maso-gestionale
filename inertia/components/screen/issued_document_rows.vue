<script setup lang="ts">
/**
 * Issued Documents, newest first, as the body of a flush section (the
 * history of a Customer, a Site or Installed Equipment): one row each,
 * the same on every screen size. Replaced ones stay listed, marked.
 */
import { Link } from '@adonisjs/inertia/vue'
import type { IssuedDocumentRow } from '~/components/issued_document_list.vue'
import { formatDate, t } from '~/i18n'
import { cn } from '~/lib/utils'
import StatusTag from './status_tag.vue'
import { LINK, ROW } from './screen'

withDefaults(defineProps<{ documents: IssuedDocumentRow[]; showCustomer?: boolean }>(), {
  showCustomer: true,
})
</script>

<template>
  <ul v-if="documents.length" class="m-0 list-none p-0">
    <li
      v-for="document in documents"
      :key="document.id"
      :class="cn(ROW, 'items-center', document.replaced && 'text-muted-foreground')"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span>
          <Link route="issued_documents.show" :params="{ id: document.id }" :class="LINK">
            {{ document.number }}
          </Link>
          · {{ document.title }}
        </span>
        <span class="text-[13px] text-muted-foreground">
          {{
            [showCustomer && document.customer, formatDate(document.issuedOn)]
              .filter(Boolean)
              .join(' · ')
          }}
        </span>
      </div>
      <StatusTag v-if="document.replaced" tone="grey">
        {{ t('ui.issuedDocuments.replaced') }}
      </StatusTag>
    </li>
  </ul>
  <p v-else class="m-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4">
    {{ t('ui.issuedDocuments.empty') }}
  </p>
</template>
