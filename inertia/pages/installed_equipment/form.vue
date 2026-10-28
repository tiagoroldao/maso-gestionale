<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import { urlFor } from '~/client'
import { t, todayIso } from '~/i18n'

type TextField = 'equipmentType' | 'make' | 'model' | 'serialNumber'

type LinkedItem = {
  id: number
  code: string
  description: string
  maintenanceIntervalMonths: number | null
  documents?: { id: number; title: string }[]
}

const props = defineProps<{
  site: { id: number; summary: string }
  equipment:
    | (Record<TextField | 'installedOn' | 'lastServicedOn' | 'notes', string | null> & {
        id: number
        maintenanceIntervalMonths: number | null
        item: LinkedItem | null
      })
    | null
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
const title = props.equipment ? t('ui.equipment.editTitle') : t('ui.equipment.addTitle')
</script>

<template>
  <AppLayout>
    <Page :title="title" :description="site.summary">
      <Form
        v-slot="{ processing, errors }"
        :route="equipment ? 'installed_equipment.update' : 'installed_equipment.store'"
        :params="equipment ? { id: equipment.id } : { siteId: site.id }"
      >
        <Section :title="t('ui.equipment.itemSection')" :description="t('ui.equipment.itemHint')">
          <input type="hidden" name="itemId" :value="item?.id ?? ''" />
          <input
            v-if="equipment"
            type="hidden"
            name="lastServicedOnWas"
            :value="equipment.lastServicedOn ?? ''"
          />
          <div v-if="item" :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
            <span
              ><span class="mono">{{ item.code }}</span> · {{ item.description }}</span
            >
            <button type="button" class="btn btn--ghost btn--sm" @click="item = null">
              {{ t('ui.equipment.unlinkItem') }}
            </button>
          </div>
          <ItemPicker v-else :label="t('ui.equipment.linkItem')" @select="linkItem" />
          <span v-if="errors.itemId" class="field__error">{{ errors.itemId }}</span>
          <ul v-if="item?.documents?.length" :style="{ margin: 0, paddingLeft: '18px' }">
            <li v-for="document in item.documents" :key="document.id">
              <a
                :href="urlFor('item_documents.show', { id: document.id })"
                target="_blank"
                rel="noopener"
                class="il"
              >
                {{ document.title }}
              </a>
            </li>
          </ul>
        </Section>

        <Section :title="t('ui.equipment.section')">
          <datalist id="equipment-types">
            <option v-for="type in commonTypes" :key="type" :value="type" />
          </datalist>
          <div v-for="field in textFields" :key="field.name" class="field">
            <label class="field__label" :for="field.name">{{ field.label }}</label>
            <input
              :id="field.name"
              v-model="values[field.name]"
              :name="field.name"
              :list="field.list"
              class="field__input"
              :aria-invalid="errors[field.name] ? 'true' : 'false'"
            />
            <span v-if="errors[field.name]" class="field__error">{{ errors[field.name] }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="installedOn">{{
              t('ui.equipment.installedOn')
            }}</label>
            <input
              id="installedOn"
              v-model="values.installedOn"
              name="installedOn"
              type="date"
              :max="today"
              class="field__input"
            />
            <span v-if="errors.installedOn" class="field__error">{{ errors.installedOn }}</span>
          </div>
        </Section>

        <Section
          :title="t('ui.equipment.maintenanceSection')"
          :description="t('ui.equipment.maintenanceDescription')"
        >
          <div class="field">
            <label class="field__label" for="maintenanceIntervalMonths">
              {{ t('ui.equipment.interval') }}
            </label>
            <input
              id="maintenanceIntervalMonths"
              v-model="values.maintenanceIntervalMonths"
              name="maintenanceIntervalMonths"
              type="number"
              min="1"
              max="120"
              class="field__input"
            />
            <span v-if="errors.maintenanceIntervalMonths" class="field__error">
              {{ errors.maintenanceIntervalMonths }}
            </span>
          </div>
          <div class="field">
            <label class="field__label" for="lastServicedOn">
              {{ t('ui.equipment.lastServicedOn') }}
            </label>
            <input
              id="lastServicedOn"
              v-model="values.lastServicedOn"
              name="lastServicedOn"
              type="date"
              :max="today"
              class="field__input"
            />
            <span v-if="errors.lastServicedOn" class="field__error">
              {{ errors.lastServicedOn }}
            </span>
          </div>
          <div class="field">
            <label class="field__label" for="notes">{{ t('ui.equipment.notes') }}</label>
            <textarea
              id="notes"
              v-model="values.notes"
              name="notes"
              class="field__input"
              rows="3"
            />
          </div>
        </Section>

        <Section>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.equipment.save') }}
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
