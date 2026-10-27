<script setup lang="ts">
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import Pagination from '~/components/pagination.vue'
import { customerTypeLabels } from '~/components/customer_types'
import { urlFor } from '~/client'

const props = defineProps<{
  q: string
  customers: {
    id: number
    displayName: string
    type: string
    vatNumber: string | null
    taxCode: string | null
    city: string
    province: string
  }[]
  pagination: { currentPage: number; lastPage: number; total: number }
}>()

const search = ref(props.q)

function submitSearch() {
  router.get(urlFor('customers.index'), search.value ? { q: search.value } : {}, {
    preserveState: true,
    replace: true,
  })
}
</script>

<template>
  <AppLayout>
    <Page title="Customers">
      <template #actions>
        <Link route="customers.create" class="btn btn--primary btn--sm">
          <Plus :size="15" /> New customer
        </Link>
      </template>

      <form
        role="search"
        :style="{ display: 'flex', gap: '8px', marginBottom: '16px' }"
        @submit.prevent="submitSearch"
      >
        <input
          v-model="search"
          type="search"
          class="field__input"
          aria-label="Search customers"
          placeholder="Name, Codice Fiscale or Partita IVA"
          :style="{ maxWidth: '360px' }"
        />
        <button type="submit" class="btn btn--secondary">Search</button>
      </form>

      <p v-if="customers.length === 0" :style="{ color: 'var(--subtle)' }">
        {{ q ? `No customers match “${q}”.` : 'No customers yet.' }}
      </p>

      <table v-else class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Partita IVA / Codice Fiscale</th>
            <th>City</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="customer in customers" :key="customer.id">
            <td>
              <Link route="customers.show" :params="{ id: customer.id }" class="il">
                {{ customer.displayName }}
              </Link>
            </td>
            <td>{{ customerTypeLabels[customer.type] }}</td>
            <td class="mono">{{ customer.vatNumber ?? customer.taxCode }}</td>
            <td>{{ customer.city }} ({{ customer.province }})</td>
            <td class="table__actions">
              <Link
                route="customers.edit"
                :params="{ id: customer.id }"
                class="btn btn--ghost btn--sm"
              >
                Edit
              </Link>
            </td>
          </tr>
        </tbody>
      </table>

      <Pagination v-bind="pagination" />
    </Page>
  </AppLayout>
</template>
