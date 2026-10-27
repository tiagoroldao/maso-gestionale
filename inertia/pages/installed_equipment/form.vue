<script setup lang="ts">
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
  { name: 'equipmentType', label: 'Type', list: 'equipment-types' },
  { name: 'make', label: 'Make' },
  { name: 'model', label: 'Model' },
  { name: 'serialNumber', label: 'Serial number' },
]

const commonTypes = [
  'Boiler',
  'Water heater',
  'Air conditioner',
  'Heat pump',
  'Solar thermal system',
  'Water softener',
  'Pressure pump',
]

const today = new Date().toISOString().slice(0, 10)
const title = props.equipment ? 'Edit equipment' : 'Add equipment'
</script>

<template>
  <AppLayout>
    <Page :title="title" :description="site.summary">
      <Form
        v-slot="{ processing, errors }"
        :route="equipment ? 'installed_equipment.update' : 'installed_equipment.store'"
        :params="equipment ? { id: equipment.id } : { siteId: site.id }"
      >
        <Section title="Equipment">
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
            <label class="field__label" for="installedOn">Install date</label>
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
          title="Maintenance"
          description="The next check is due one interval after the last service, or after installation."
        >
          <div class="field">
            <label class="field__label" for="maintenanceIntervalMonths">
              Maintenance Interval (months)
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
            <label class="field__label" for="lastServicedOn">Last serviced</label>
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
            <label class="field__label" for="notes">Notes</label>
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
            Save equipment
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
