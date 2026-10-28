<script setup lang="ts">
/**
 * Issued Documents in a table, newest first, as in the Customer, Site and
 * Installed Equipment history. Replaced ones stay listed, marked.
 */
import { Link } from '@adonisjs/inertia/vue'
import { formatDate, t } from '~/i18n'

export type IssuedDocumentRow = {
  id: number
  number: string
  title: string
  issuedOn: string
  customer: string
  replaced: boolean
}

withDefaults(defineProps<{ documents: IssuedDocumentRow[]; showCustomer?: boolean }>(), {
  showCustomer: true,
})
</script>

<template>
  <table v-if="documents.length" class="table">
    <thead>
      <tr>
        <th>{{ t('ui.issuedDocuments.number') }}</th>
        <th>{{ t('ui.issuedDocuments.document') }}</th>
        <th v-if="showCustomer">{{ t('ui.issuedDocuments.customer') }}</th>
        <th>{{ t('ui.issuedDocuments.issuedOn') }}</th>
        <th />
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="document in documents"
        :key="document.id"
        :class="{ 'table__row--muted': document.replaced }"
      >
        <td class="mono">
          <Link route="issued_documents.show" :params="{ id: document.id }" class="il">
            {{ document.number }}
          </Link>
        </td>
        <td>{{ document.title }}</td>
        <td v-if="showCustomer">{{ document.customer }}</td>
        <td>{{ formatDate(document.issuedOn) }}</td>
        <td>
          <span v-if="document.replaced" class="tag">{{ t('ui.issuedDocuments.replaced') }}</span>
        </td>
      </tr>
    </tbody>
  </table>
  <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.issuedDocuments.empty') }}</p>
</template>
