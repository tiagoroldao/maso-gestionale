<script setup lang="ts">
/**
 * Installed Equipment in edit mode (docs/ui.md "Kinds of screen"), under
 * its Site: the form is the screen, Save its primary action. Linking the
 * Item sold shows its documents and proposes its Maintenance Interval.
 */
import { reactive, ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import type { IssuedDocumentRow } from '~/components/issued_document_list.vue'
import { urlFor } from '~/client'
import { t, todayIso } from '~/i18n'
import type { ScreenAction } from '@shared/screen_actions'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import FormField from '~/components/screen/form_field.vue'
import IssuedDocumentRows from '~/components/screen/issued_document_rows.vue'
import { LINK } from '~/components/screen/screen'

type TextField = 'equipmentType' | 'make' | 'model' | 'serialNumber'

type LinkedItem = {
  id: number
  code: string
  description: string
  maintenanceIntervalMonths: number | null
  documents?: { id: number; title: string }[]
}

const props = defineProps<{
  // Save, the screen's primary
  actions: ScreenAction[]
  site: { id: number; summary: string }
  equipment:
    | (Record<TextField | 'installedOn' | 'lastServicedOn' | 'notes', string | null> & {
        id: number
        description: string
        maintenanceIntervalMonths: number | null
        item: LinkedItem | null
      })
    | null
  issuedDocuments: IssuedDocumentRow[]
}>()

/**
 * Field values live in reactive state, so choosing an Item (which
 * re-renders the form) doesn't wipe what was typed.
 */
const values = reactive({
  equipmentType: props.equipment?.equipmentType ?? '',
  make: props.equipment?.make ?? '',
  model: props.equipment?.model ?? '',
  serialNumber: props.equipment?.serialNumber ?? '',
  installedOn: props.equipment?.installedOn ?? '',
  maintenanceIntervalMonths: String(props.equipment?.maintenanceIntervalMonths ?? ''),
  lastServicedOn: props.equipment?.lastServicedOn ?? '',
  notes: props.equipment?.notes ?? '',
})
const item = ref<LinkedItem | null>(props.equipment?.item ?? null)

/**
 * Linking an Item fills in its default Maintenance Interval, unless one
 * was already entered.
 */
function linkItem(picked: PickedItem) {
  item.value = { ...picked, documents: undefined }
  if (!values.maintenanceIntervalMonths && picked.maintenanceIntervalMonths) {
    values.maintenanceIntervalMonths = String(picked.maintenanceIntervalMonths)
  }
}

const textFields: { name: TextField; label: string; list?: string }[] = [
  { name: 'equipmentType', label: t('ui.equipment.type'), list: 'equipment-types' },
  { name: 'make', label: t('ui.equipment.make') },
  { name: 'model', label: t('ui.equipment.model') },
  { name: 'serialNumber', label: t('ui.equipment.serialNumber') },
]

const commonTypes = [
  'boiler',
  'waterHeater',
  'airConditioner',
  'heatPump',
  'solarThermal',
  'waterSoftener',
  'pressurePump',
].map((key) => t(`ui.equipment.commonTypes.${key}`))

const today = todayIso()
// Under its Site, whatever reached it
const crumbs = [
  { label: t('ui.sites.title'), href: urlFor('sites.index') },
  { label: props.site.summary, href: urlFor('sites.show', { id: props.site.id }) },
]
const title = props.equipment?.description ?? t('ui.equipment.addTitle')
const current = props.equipment ? t('ui.common.edit') : t('ui.equipment.addTitle')
const documentTitle = props.equipment ? t('ui.equipment.editTitle') : t('ui.equipment.addTitle')

const INPUT = 'h-11 md:h-9'
const HINT = 'm-0 text-[13px] text-muted-foreground'
</script>

<template>
  <AppLayout>
    <Form
      v-slot="{ processing, errors }"
      :route="equipment ? 'installed_equipment.update' : 'installed_equipment.store'"
      :params="equipment ? { id: equipment.id } : { siteId: site.id }"
      class="w-full min-w-0"
    >
      <input type="hidden" name="itemId" :value="item?.id ?? ''" />
      <input
        v-if="equipment"
        type="hidden"
        name="lastServicedOnWas"
        :value="equipment.lastServicedOn ?? ''"
      />
      <EntityScreen
        :document-title="documentTitle"
        :crumbs="crumbs"
        :current="current"
        :title="title"
        :facts="site.summary"
        :actions="actions"
        :busy="processing"
      >
        <template #main>
          <ScreenSection :title="t('ui.equipment.section')">
            <datalist id="equipment-types">
              <option v-for="type in commonTypes" :key="type" :value="type" />
            </datalist>
            <div class="grid gap-4 md:grid-cols-2">
              <FormField
                v-for="input in textFields"
                :id="input.name"
                :key="input.name"
                v-slot="field"
                :label="input.label"
                :error="errors[input.name]"
              >
                <Input
                  :id="field.id"
                  v-model="values[input.name]"
                  :name="input.name"
                  :list="input.list"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="installedOn"
                v-slot="field"
                :label="t('ui.equipment.installedOn')"
                :error="errors.installedOn"
              >
                <Input
                  :id="field.id"
                  v-model="values.installedOn"
                  name="installedOn"
                  type="date"
                  :max="today"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </div>
          </ScreenSection>

          <ScreenSection :title="t('ui.equipment.maintenanceSection')">
            <p :class="HINT">{{ t('ui.equipment.maintenanceDescription') }}</p>
            <div class="grid gap-4 md:grid-cols-2">
              <FormField
                id="maintenanceIntervalMonths"
                v-slot="field"
                :label="t('ui.equipment.interval')"
                :error="errors.maintenanceIntervalMonths"
              >
                <Input
                  :id="field.id"
                  v-model="values.maintenanceIntervalMonths"
                  name="maintenanceIntervalMonths"
                  type="number"
                  min="1"
                  max="120"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="lastServicedOn"
                v-slot="field"
                :label="t('ui.equipment.lastServicedOn')"
                :error="errors.lastServicedOn"
              >
                <Input
                  :id="field.id"
                  v-model="values.lastServicedOn"
                  name="lastServicedOn"
                  type="date"
                  :max="today"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </div>
            <FormField id="notes" v-slot="field" :label="t('ui.equipment.notes')">
              <Textarea
                :id="field.id"
                v-model="values.notes"
                name="notes"
                rows="3"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </ScreenSection>
        </template>

        <template #side>
          <ScreenSection :title="t('ui.equipment.itemSection')">
            <p :class="HINT">{{ t('ui.equipment.itemHint') }}</p>
            <div v-if="item" class="flex items-center justify-between gap-2 text-sm">
              <span class="min-w-0">
                <span class="font-semibold">{{ item.code }}</span> · {{ item.description }}
              </span>
              <Button type="button" variant="ghost" :class="INPUT" @click="item = null">
                {{ t('ui.equipment.unlinkItem') }}
              </Button>
            </div>
            <ItemPicker v-else :label="t('ui.equipment.linkItem')" @select="linkItem" />
            <p v-if="errors.itemId" class="m-0 flex items-start gap-1.5 text-sm text-destructive">
              <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
              {{ errors.itemId }}
            </p>
            <ul v-if="item?.documents?.length" class="m-0 flex list-none flex-col gap-1.5 p-0">
              <li v-for="document in item.documents" :key="document.id" class="text-sm">
                <a
                  :href="urlFor('item_documents.show', { id: document.id })"
                  target="_blank"
                  rel="noopener"
                  :class="LINK"
                >
                  {{ document.title }}
                </a>
              </li>
            </ul>
          </ScreenSection>

          <ScreenSection v-if="equipment" :title="t('ui.issuedDocuments.title')" flush>
            <IssuedDocumentRows :documents="issuedDocuments" />
          </ScreenSection>
        </template>
      </EntityScreen>
    </Form>
  </AppLayout>
</template>
