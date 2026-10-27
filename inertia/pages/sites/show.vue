<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'
import { Pencil, Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'

defineProps<{
  site: { id: number; summary: string; accessNotes: string | null }
  customers: { id: number; displayName: string }[]
  installedEquipment: {
    id: number
    description: string
    serialNumber: string | null
    installedOn: string | null
    maintenanceIntervalMonths: number | null
    nextDueOn: string | null
  }[]
}>()

const today = new Date().toISOString().slice(0, 10)
</script>

<template>
  <AppLayout>
    <Page :title="site.summary">
      <template #actions>
        <Link route="sites.edit" :params="{ id: site.id }" class="btn btn--secondary btn--sm">
          <Pencil :size="15" /> Edit site
        </Link>
      </template>

      <Section v-if="site.accessNotes" title="Access notes">
        <p :style="{ whiteSpace: 'pre-line', margin: 0 }">{{ site.accessNotes }}</p>
      </Section>

      <Section title="Customers">
        <ul v-if="customers.length" :style="{ margin: 0, paddingLeft: '18px' }">
          <li v-for="customer in customers" :key="customer.id">
            <Link route="customers.show" :params="{ id: customer.id }" class="il">
              {{ customer.displayName }}
            </Link>
          </li>
        </ul>
        <p v-else :style="{ color: 'var(--subtle)' }">Not linked to any Customer.</p>
      </Section>

      <Section title="Installed Equipment">
        <table v-if="installedEquipment.length" class="table">
          <thead>
            <tr>
              <th>Equipment</th>
              <th>Serial number</th>
              <th>Installed</th>
              <th>Next check due</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="equipment in installedEquipment" :key="equipment.id">
              <td>{{ equipment.description }}</td>
              <td class="mono">{{ equipment.serialNumber }}</td>
              <td>{{ equipment.installedOn }}</td>
              <td>
                <template v-if="equipment.nextDueOn">
                  {{ equipment.nextDueOn }}
                  <span v-if="equipment.nextDueOn < today" class="tag">overdue</span>
                </template>
                <span v-else-if="equipment.maintenanceIntervalMonths" class="field__hint">
                  Every {{ equipment.maintenanceIntervalMonths }} months, no date to count from
                </span>
              </td>
              <td class="table__actions">
                <Link
                  route="installed_equipment.edit"
                  :params="{ id: equipment.id }"
                  class="btn btn--ghost btn--sm"
                >
                  Edit
                </Link>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">No equipment recorded yet.</p>
        <div>
          <Link
            route="installed_equipment.create"
            :params="{ siteId: site.id }"
            class="btn btn--secondary btn--sm"
          >
            <Plus :size="15" /> Add equipment
          </Link>
        </div>
      </Section>
    </Page>
  </AppLayout>
</template>
