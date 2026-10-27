<script setup lang="ts">
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import Pagination from '~/components/pagination.vue'
import { urlFor } from '~/client'

const props = defineProps<{
  q: string
  sites: { id: number; summary: string; customerCount: number }[]
  pagination: { currentPage: number; lastPage: number; total: number }
}>()

const search = ref(props.q)

function submitSearch() {
  router.get(urlFor('sites.index'), search.value ? { q: search.value } : {}, {
    preserveState: true,
    replace: true,
  })
}
</script>

<template>
  <AppLayout>
    <Page title="Sites" description="Addresses where work is done, whoever the Customer.">
      <template #actions>
        <Link route="sites.create" class="btn btn--primary btn--sm">
          <Plus :size="15" /> New site
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
          aria-label="Search sites"
          placeholder="Street, city or label"
          :style="{ maxWidth: '360px' }"
        />
        <button type="submit" class="btn btn--secondary">Search</button>
      </form>

      <p v-if="sites.length === 0" :style="{ color: 'var(--subtle)' }">
        {{ q ? `No sites match “${q}”.` : 'No sites yet.' }}
      </p>

      <table v-else class="table">
        <thead>
          <tr>
            <th>Site</th>
            <th>Customers</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="site in sites" :key="site.id">
            <td>{{ site.summary }}</td>
            <td>{{ site.customerCount }}</td>
            <td class="table__actions">
              <Link route="sites.edit" :params="{ id: site.id }" class="btn btn--ghost btn--sm">
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
