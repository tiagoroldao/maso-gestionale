<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import { Pencil, Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, t, todayIso } from '~/i18n'
import JobList, { type JobRow } from '~/components/job_list.vue'
import IssuedDocumentList, { type IssuedDocumentRow } from '~/components/issued_document_list.vue'

defineProps<{
  site: { id: number; summary: string; accessNotes: string | null; archived: boolean }
  customers: { id: number; displayName: string }[]
  jobs: { rows: JobRow[]; total: number }
  issuedDocuments: IssuedDocumentRow[]
  installedEquipment: {
    id: number
    description: string
    serialNumber: string | null
    installedOn: string | null
    maintenanceIntervalMonths: number | null
    nextDueOn: string | null
    itemCode: string | null
    documentCount: number
    removedOn: string | null
    replacedBy: string | null
  }[]
  removedEquipment: {
    id: number
    description: string
    removedOn: string | null
    replacedBy: string | null
  }[]
}>()

const today = todayIso()
const confirm = (message: string) => window.confirm(message)
</script>

<template>
  <AppLayout>
    <Page :title="site.summary">
      <template #actions>
        <Link route="sites.edit" :params="{ id: site.id }" class="btn btn--secondary btn--sm">
          <Pencil :size="15" /> {{ t('ui.sites.editSite') }}
        </Link>
        <Form
          :route="site.archived ? 'sites.restore' : 'sites.archive'"
          :params="{ id: site.id }"
          :on-before="() => site.archived || confirm(t('ui.archive.confirm'))"
        >
          <button type="submit" class="btn btn--ghost btn--sm">
            {{ site.archived ? t('ui.archive.restore') : t('ui.archive.archive') }}
          </button>
        </Form>
      </template>

      <p v-if="site.archived" class="tag">{{ t('ui.archive.archivedTag') }}</p>

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
        <JobList v-if="jobs.rows.length" :jobs="jobs.rows" :show-site="false" />
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.jobs.empty') }}</p>
        <p v-if="jobs.total > jobs.rows.length">
          <Link route="jobs.index" :qs="{ siteId: site.id, status: 'all' }">{{
            t('ui.jobs.allOf', { total: jobs.total })
          }}</Link>
        </p>
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
                <Form
                  route="installed_equipment.remove"
                  :params="{ id: equipment.id }"
                  :on-before="() => confirm(t('ui.equipment.removeConfirm'))"
                  :style="{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }"
                >
                  <input
                    name="removedOn"
                    type="date"
                    class="field__input"
                    :value="today"
                    :aria-label="t('ui.equipment.removedOnOf', { name: equipment.description })"
                  />
                  <select
                    name="replacedById"
                    class="field__input"
                    :aria-label="t('ui.equipment.replacedByOf', { name: equipment.description })"
                  >
                    <option value="">{{ t('ui.equipment.noReplacement') }}</option>
                    <option
                      v-for="other in installedEquipment.filter((e) => e.id !== equipment.id)"
                      :key="other.id"
                      :value="other.id"
                    >
                      {{ other.description }}
                    </option>
                  </select>
                  <button type="submit" class="btn btn--ghost btn--sm">
                    {{ t('ui.equipment.remove') }}
                  </button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.equipment.empty') }}</p>
        <template v-if="removedEquipment.length">
          <h3>{{ t('ui.equipment.removedTitle') }}</h3>
          <ul :style="{ margin: 0, paddingLeft: '18px' }">
            <li v-for="equipment in removedEquipment" :key="equipment.id">
              {{ equipment.description }} ·
              {{ t('ui.equipment.removedOn', { date: formatDate(equipment.removedOn) }) }}
              <span v-if="equipment.replacedBy">
                · {{ t('ui.equipment.replacedBy', { name: equipment.replacedBy }) }}
              </span>
            </li>
          </ul>
        </template>
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
      <Section :title="t('ui.issuedDocuments.title')">
        <IssuedDocumentList :documents="issuedDocuments" />
      </Section>
    </Page>
  </AppLayout>
</template>
