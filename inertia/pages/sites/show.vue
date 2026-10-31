<script setup lang="ts">
/**
 * The Site, an Entity screen on the new UI (docs/ui.md): its header
 * actions come from the server; its Installed Equipment and Jobs are the
 * main work, its access notes, Customers and documents beside them.
 */
import { computed, ref } from 'vue'
import { Form, Link } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { formatDate, t, todayIso } from '~/i18n'
import { cn } from '~/lib/utils'
import type { ScreenAction } from '@shared/screen_actions'
import type { JobRow } from '~/components/screen/job_rows.vue'
import type { IssuedDocumentRow } from '~/components/issued_document_list.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import FormField from '~/components/screen/form_field.vue'
import JobRows from '~/components/screen/job_rows.vue'
import IssuedDocumentRows from '~/components/screen/issued_document_rows.vue'
import type { KeyFact } from '~/components/screen/key_facts.vue'
import { LINK, ROW, TD, TH } from '~/components/screen/screen'

type Equipment = {
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
}

const props = defineProps<{
  // The header's actions, for the Site's state
  actions: ScreenAction[]
  site: {
    id: number
    summary: string
    accessNotes: string | null
    residential: boolean
    archived: boolean
  }
  customers: { id: number; displayName: string }[]
  jobs: { rows: JobRow[]; total: number }
  // Its Jobs still taking work
  openJobs: number
  // The soonest check due on the equipment still installed
  nextDueOn: string | null
  issuedDocuments: IssuedDocumentRow[]
  installedEquipment: Equipment[]
  removedEquipment: {
    id: number
    description: string
    removedOn: string | null
    replacedBy: string | null
  }[]
}>()

const today = todayIso()
const overdue = (date: string | null) => date !== null && date < today
const jobsHref = computed(() => `${urlFor('jobs.index')}?siteId=${props.site.id}`)
// Every one of its Jobs, closed and cancelled included: what "Tutte le N commesse" counts
const allJobsHref = computed(() => `${jobsHref.value}&status=all`)

// The header's line, and the key facts under it
const facts = computed(() =>
  props.site.residential ? t('ui.sites.residentialFact') : t('ui.sites.notResidentialFact')
)
const keyFacts = computed<KeyFact[]>(() => {
  const [first, ...others] = props.customers
  return [
    {
      label: t('ui.sites.customers'),
      value: first?.displayName ?? t('ui.sites.noCustomer'),
      href: first ? urlFor('customers.show', { id: first.id }) : undefined,
      hint: others.length ? t('ui.sites.moreCustomers', { count: others.length }) : undefined,
    },
    { label: t('ui.jobs.openJobs'), value: String(props.openJobs), href: jobsHref.value },
    {
      label: t('ui.equipment.installedCount'),
      value: String(props.installedEquipment.length),
    },
    {
      label: t('ui.equipment.nextDue'),
      value: props.nextDueOn ? formatDate(props.nextDueOn) : '—',
      hint: overdue(props.nextDueOn) ? t('ui.equipment.overdue') : undefined,
    },
  ]
})

// Marking equipment removed: its date and what replaced it, then confirmed (a short dialog)
const removing = ref<Equipment | null>(null)
const removeOpen = ref(false)
const replacedById = ref('')
function askRemove(equipment: Equipment) {
  removing.value = equipment
  replacedById.value = ''
  removeOpen.value = true
}
const replacements = computed(() =>
  props.installedEquipment.filter((other) => other.id !== removing.value?.id)
)

const BUTTON = 'h-11 md:h-9'
const EMPTY = 'm-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4'
const SUB = 'text-[13px] text-muted-foreground'
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="site.summary"
      :crumbs="[{ label: t('ui.sites.title'), href: urlFor('sites.index') }]"
      :current="site.summary"
      :title="site.summary"
      :facts="facts"
      :actions="actions"
      :key-facts="keyFacts"
    >
      <template #tags>
        <StatusTag v-if="site.archived" tone="grey">{{ t('ui.archive.archivedTag') }}</StatusTag>
      </template>

      <template #main>
        <ScreenSection :title="t('ui.equipment.sectionTitle')" flush>
          <template #actions>
            <Button as-child variant="outline" :class="BUTTON">
              <Link route="installed_equipment.create" :params="{ siteId: site.id }">
                {{ t('ui.equipment.add') }}
              </Link>
            </Button>
          </template>
          <template v-if="installedEquipment.length">
            <div class="hidden overflow-x-auto md:block">
              <table class="w-full border-collapse" data-testid="installed-equipment">
                <thead>
                  <tr>
                    <th :class="TH">{{ t('ui.equipment.equipment') }}</th>
                    <th :class="TH">{{ t('ui.equipment.serialNumber') }}</th>
                    <th :class="TH">{{ t('ui.equipment.installed') }}</th>
                    <th :class="TH">{{ t('ui.equipment.nextDue') }}</th>
                    <th :class="TH">
                      <span class="sr-only">{{ t('ui.common.edit') }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="equipment in installedEquipment" :key="equipment.id">
                    <td :class="TD">
                      <span class="font-semibold">{{ equipment.description }}</span>
                      <p
                        v-if="equipment.itemCode || equipment.documentCount"
                        :class="cn(SUB, 'm-0')"
                      >
                        {{
                          [
                            equipment.itemCode,
                            equipment.documentCount &&
                              t('ui.equipment.documents', { count: equipment.documentCount }),
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        }}
                      </p>
                    </td>
                    <td :class="TD">{{ equipment.serialNumber }}</td>
                    <td :class="cn(TD, 'whitespace-nowrap')">
                      {{ formatDate(equipment.installedOn) }}
                    </td>
                    <td :class="TD">
                      <span v-if="equipment.nextDueOn" class="flex flex-wrap items-center gap-1.5">
                        <span class="whitespace-nowrap">{{ formatDate(equipment.nextDueOn) }}</span>
                        <StatusTag v-if="overdue(equipment.nextDueOn)" tone="orange">
                          {{ t('ui.equipment.overdue') }}
                        </StatusTag>
                      </span>
                      <span v-else-if="equipment.maintenanceIntervalMonths" :class="SUB">
                        {{
                          t('ui.equipment.noDate', { months: equipment.maintenanceIntervalMonths })
                        }}
                      </span>
                    </td>
                    <td :class="cn(TD, 'text-right whitespace-nowrap')">
                      <span class="inline-flex items-center gap-3">
                        <Link
                          route="installed_equipment.edit"
                          :params="{ id: equipment.id }"
                          :class="LINK"
                        >
                          {{ t('ui.common.edit') }}
                        </Link>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          @click="askRemove(equipment)"
                        >
                          {{ t('ui.equipment.remove') }}
                        </Button>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul class="m-0 list-none p-0 md:hidden">
              <li
                v-for="equipment in installedEquipment"
                :key="equipment.id"
                :class="cn(ROW, 'flex-col gap-2')"
              >
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="text-[15px] font-semibold">{{ equipment.description }}</span>
                  <span :class="SUB">
                    {{
                      [
                        equipment.serialNumber,
                        equipment.installedOn &&
                          `${t('ui.equipment.installed')} ${formatDate(equipment.installedOn)}`,
                        equipment.itemCode,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    }}
                  </span>
                  <span
                    v-if="equipment.nextDueOn"
                    class="flex flex-wrap items-center gap-1.5 text-sm"
                  >
                    {{ t('ui.equipment.nextDue') }}: {{ formatDate(equipment.nextDueOn) }}
                    <StatusTag v-if="overdue(equipment.nextDueOn)" tone="orange">
                      {{ t('ui.equipment.overdue') }}
                    </StatusTag>
                  </span>
                  <span v-else-if="equipment.maintenanceIntervalMonths" :class="SUB">
                    {{ t('ui.equipment.noDate', { months: equipment.maintenanceIntervalMonths }) }}
                  </span>
                </div>
                <div class="flex items-center gap-4">
                  <Link
                    route="installed_equipment.edit"
                    :params="{ id: equipment.id }"
                    :class="cn(LINK, 'flex min-h-11 items-center text-sm')"
                  >
                    {{ t('ui.common.edit') }}
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    :class="BUTTON"
                    @click="askRemove(equipment)"
                  >
                    {{ t('ui.equipment.remove') }}
                  </Button>
                </div>
              </li>
            </ul>
          </template>
          <p v-else :class="EMPTY">{{ t('ui.equipment.empty') }}</p>

          <div
            v-if="removedEquipment.length"
            class="flex flex-col gap-1.5 border-t border-border px-3.5 py-3 md:px-4"
          >
            <h3 class="m-0 text-xs font-semibold text-muted-foreground">
              {{ t('ui.equipment.removedTitle') }}
            </h3>
            <p v-for="equipment in removedEquipment" :key="equipment.id" class="m-0 text-sm">
              {{ equipment.description }} ·
              {{ t('ui.equipment.removedOn', { date: formatDate(equipment.removedOn) }) }}
              <template v-if="equipment.replacedBy">
                · {{ t('ui.equipment.replacedBy', { name: equipment.replacedBy }) }}
              </template>
            </p>
          </div>
        </ScreenSection>

        <ScreenSection :title="t('ui.jobs.title')" flush>
          <JobRows :jobs="jobs.rows" :total="jobs.total" :all-href="allJobsHref" show-customer />
        </ScreenSection>
      </template>

      <template #side>
        <ScreenSection v-if="site.accessNotes" :title="t('ui.sites.accessNotes')">
          <p class="m-0 text-sm whitespace-pre-line">{{ site.accessNotes }}</p>
        </ScreenSection>

        <ScreenSection :title="t('ui.sites.customers')" flush>
          <ul v-if="customers.length" class="m-0 list-none p-0">
            <li v-for="customer in customers" :key="customer.id" :class="ROW">
              <Link
                route="customers.show"
                :params="{ id: customer.id }"
                :class="cn(LINK, 'text-sm')"
              >
                {{ customer.displayName }}
              </Link>
            </li>
          </ul>
          <p v-else :class="EMPTY">{{ t('ui.sites.notLinked') }}</p>
        </ScreenSection>

        <ScreenSection :title="t('ui.issuedDocuments.title')" flush>
          <IssuedDocumentRows :documents="issuedDocuments" />
        </ScreenSection>
      </template>
    </EntityScreen>

    <!-- Taken out, maybe replaced by other equipment here: confirmed by its own button -->
    <Dialog v-model:open="removeOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.equipment.remove') }}</DialogTitle>
        <DialogDescription>
          {{ removing?.description }} · {{ t('ui.equipment.removeConfirm') }}
        </DialogDescription>
        <Form
          v-if="removing"
          v-slot="{ processing, errors }"
          route="installed_equipment.remove"
          :params="{ id: removing.id }"
          class="flex flex-col gap-4"
          @success="removeOpen = false"
        >
          <FormField
            id="equipment-removed-on"
            v-slot="field"
            :label="t('ui.equipment.removedOnLabel')"
            :error="errors.removedOn"
          >
            <Input
              :id="field.id"
              name="removedOn"
              type="date"
              :default-value="today"
              :max="today"
              class="h-11 md:h-9"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <FormField
            id="equipment-replaced-by"
            v-slot="field"
            :label="t('ui.equipment.replacedByLabel')"
            :error="errors.replacedById"
          >
            <NativeSelect
              :id="field.id"
              v-model="replacedById"
              name="replacedById"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            >
              <option value="">{{ t('ui.equipment.noReplacement') }}</option>
              <option v-for="other in replacements" :key="other.id" :value="String(other.id)">
                {{ other.description }}
              </option>
            </NativeSelect>
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="BUTTON" @click="removeOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="BUTTON" :disabled="processing">
              {{ t('ui.equipment.remove') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  </AppLayout>
</template>
