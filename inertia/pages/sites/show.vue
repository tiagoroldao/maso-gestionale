<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'
import { Pencil, Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, t, todayIso } from '~/i18n'
import JobList, { type JobRow } from '~/components/job_list.vue'

defineProps<{
  site: { id: number; summary: string; accessNotes: string | null }
  customers: { id: number; displayName: string }[]
  jobs: JobRow[]
  installedEquipment: {
    id: number
    description: string
    serialNumber: string | null
    installedOn: string | null
    maintenanceIntervalMonths: number | null
    nextDueOn: string | null
    itemCode: string | null
    documentCount: number
  }[]
}>()

const today = todayIso()
</script>

<template>
  <AppLayout>
    <Page :title="site.summary">
      <template #actions>
        <Link route="sites.edit" :params="{ id: site.id }" class="btn btn--secondary btn--sm">
          <Pencil :size="15" /> {{ t('ui.sites.editSite') }}
        </Link>
      </template>

      <Section v-if="site.accessNotes" :title="t('ui.sites.accessNotes')">
        <p :style="{ whiteSpace: 'pre-line', margin: 0 }">{{ site.accessNotes }}</p>
      </Section>

      <Section :title="t('ui.sites.customers')">
        <ul v-if="customers.length" :style="{ margin: 0, paddingLeft: '18px' }">
          <li v-for="customer in customers" :key="customer.id">
            <Link route="customers.show" :params="{ id: customer.id }" class="il">
              {{ customer.displayName }}
            </Link>
          </li>
        </ul>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.sites.notLinked') }}</p>
      </Section>

      <Section :title="t('ui.jobs.title')">
        <JobList v-if="jobs.length" :jobs="jobs" :show-site="false" />
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.jobs.empty') }}</p>
      </Section>

      <Section :title="t('ui.equipment.sectionTitle')">
        <table v-if="installedEquipment.length" class="table">
          <thead>
            <tr>
              <th>{{ t('ui.equipment.equipment') }}</th>
              <th>{{ t('ui.equipment.serialNumber') }}</th>
              <th>{{ t('ui.equipment.installed') }}</th>
              <th>{{ t('ui.equipment.nextDue') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="equipment in installedEquipment" :key="equipment.id">
              <td>
                {{ equipment.description }}
                <span v-if="equipment.itemCode" class="mono tag">{{ equipment.itemCode }}</span>
                <span v-if="equipment.documentCount" class="field__hint">
                  · {{ t('ui.equipment.documents', { count: equipment.documentCount }) }}
                </span>
              </td>
              <td class="mono">{{ equipment.serialNumber }}</td>
              <td>{{ formatDate(equipment.installedOn) }}</td>
              <td>
                <template v-if="equipment.nextDueOn">
                  {{ formatDate(equipment.nextDueOn) }}
                  <span v-if="equipment.nextDueOn < today" class="tag">
                    {{ t('ui.equipment.overdue') }}
                  </span>
                </template>
                <span v-else-if="equipment.maintenanceIntervalMonths" class="field__hint">
                  {{ t('ui.equipment.noDate', { months: equipment.maintenanceIntervalMonths }) }}
                </span>
              </td>
              <td class="table__actions">
                <Link
                  route="installed_equipment.edit"
                  :params="{ id: equipment.id }"
                  class="btn btn--ghost btn--sm"
                >
                  {{ t('ui.common.edit') }}
                </Link>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.equipment.empty') }}</p>
        <div>
          <Link
            route="installed_equipment.create"
            :params="{ siteId: site.id }"
            class="btn btn--secondary btn--sm"
          >
            <Plus :size="15" /> {{ t('ui.equipment.add') }}
          </Link>
        </div>
      </Section>
    </Page>
  </AppLayout>
</template>
