<script setup lang="ts">
import { t, todayIso } from '~/i18n'
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'

type TextField = 'equipmentType' | 'make' | 'model' | 'serialNumber'

const props = defineProps<{
  site: { id: number; summary: string }
  equipment:
    | (Record<TextField | 'installedOn' | 'lastServicedOn' | 'notes', string | null> & {
        id: number
        maintenanceIntervalMonths: number | null
      })
    | null
}>()

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
        <Section :title="t('ui.equipment.section')">
          <datalist id="equipment-types">
            <option v-for="type in commonTypes" :key="type" :value="type" />
          </datalist>
          <div v-for="field in textFields" :key="field.name" class="field">
            <label class="field__label" :for="field.name">{{ field.label }}</label>
            <input
              :id="field.name"
              :name="field.name"
              :list="field.list"
              class="field__input"
              :value="equipment?.[field.name] ?? ''"
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
              name="installedOn"
              type="date"
              :max="today"
              class="field__input"
              :value="equipment?.installedOn ?? ''"
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
              name="maintenanceIntervalMonths"
              type="number"
              min="1"
              max="120"
              class="field__input"
              :value="equipment?.maintenanceIntervalMonths ?? ''"
            />
            <span v-if="errors.maintenanceIntervalMonths" class="field__error">
              {{ errors.maintenanceIntervalMonths }}
            </span>
          </div>
          <div class="field">
            <label class="field__label" for="lastServicedOn">{{
              t('ui.equipment.lastServicedOn')
            }}</label>
            <input
              id="lastServicedOn"
              name="lastServicedOn"
              type="date"
              :max="today"
              class="field__input"
              :value="equipment?.lastServicedOn ?? ''"
            />
            <span v-if="errors.lastServicedOn" class="field__error">
              {{ errors.lastServicedOn }}
            </span>
          </div>
          <div class="field">
            <label class="field__label" for="notes">{{ t('ui.equipment.notes') }}</label>
            <textarea
              id="notes"
              name="notes"
              class="field__input"
              rows="3"
              :value="equipment?.notes ?? ''"
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
