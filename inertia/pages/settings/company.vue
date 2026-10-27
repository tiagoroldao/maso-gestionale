<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'

type TextField =
  | 'name'
  | 'vatNumber'
  | 'taxCode'
  | 'street'
  | 'streetNumber'
  | 'postalCode'
  | 'city'
  | 'province'
  | 'iban'
  | 'email'
  | 'phone'

const props = defineProps<{
  settings: Record<TextField | 'taxRegime', string | null> & {
    hasLogo: boolean
    updatedAt: string | null
  }
  taxRegimes: Record<string, string>
}>()

type Field = { name: TextField; label: string; hint?: string; type?: string }

const sections: { title: string; description?: string; fields: Field[] }[] = [
  {
    title: 'Company',
    fields: [
      { name: 'name', label: 'Company name (ragione sociale)' },
      { name: 'vatNumber', label: 'Partita IVA' },
      {
        name: 'taxCode',
        label: 'Codice Fiscale',
        hint: 'For most companies this is the same as the Partita IVA.',
      },
    ],
  },
  {
    title: 'Registered address',
    fields: [
      { name: 'street', label: 'Street' },
      { name: 'streetNumber', label: 'Street number' },
      { name: 'postalCode', label: 'CAP' },
      { name: 'city', label: 'Comune' },
      { name: 'province', label: 'Provincia', hint: 'Two letters, e.g. MI.' },
    ],
  },
  {
    title: 'Payments and contacts',
    description: 'Optional. Printed on invoices and documents when filled in.',
    fields: [
      { name: 'iban', label: 'IBAN' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone', type: 'tel' },
    ],
  },
]

const logoUrl = props.settings.updatedAt
  ? `/company/logo?v=${encodeURIComponent(props.settings.updatedAt)}`
  : '/company/logo'
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Form v-slot="{ processing, errors }" route="company_settings.update">
        <Section
          v-for="section in sections"
          :key="section.title"
          :title="section.title"
          :description="section.description"
        >
          <div v-for="field in section.fields" :key="field.name" class="field">
            <label class="field__label" :for="field.name">{{ field.label }}</label>
            <input
              :id="field.name"
              :name="field.name"
              :type="field.type ?? 'text'"
              class="field__input"
              :value="settings[field.name] ?? ''"
              :aria-invalid="errors[field.name] ? 'true' : 'false'"
            />
            <span v-if="field.hint" class="field__hint">{{ field.hint }}</span>
            <span v-if="errors[field.name]" class="field__error">{{ errors[field.name] }}</span>
          </div>

          <div v-if="section.title === 'Company'" class="field">
            <label class="field__label" for="taxRegime">Tax regime (regime fiscale)</label>
            <select
              id="taxRegime"
              name="taxRegime"
              class="field__input"
              :value="settings.taxRegime ?? 'RF01'"
            >
              <option v-for="(label, code) in taxRegimes" :key="code" :value="code">
                {{ code }} – {{ label }}
              </option>
            </select>
            <span v-if="errors.taxRegime" class="field__error">{{ errors.taxRegime }}</span>
          </div>
        </Section>

        <Section title="Logo" description="PNG, JPEG or WebP, up to 2 MB.">
          <img
            v-if="settings.hasLogo"
            :src="logoUrl"
            alt="Current logo"
            :style="{ maxHeight: '80px', maxWidth: '240px', objectFit: 'contain' }"
          />
          <div class="field">
            <label class="field__label" for="logo">
              {{ settings.hasLogo ? 'Replace logo' : 'Upload logo' }}
            </label>
            <input id="logo" name="logo" type="file" accept=".png,.jpg,.jpeg,.webp" />
            <span v-if="errors.logo" class="field__error">{{ errors.logo }}</span>
          </div>
          <label
            v-if="settings.hasLogo"
            :style="{ display: 'flex', gap: '8px', alignItems: 'center' }"
          >
            <input type="checkbox" name="removeLogo" value="true" /> Remove the logo
          </label>
        </Section>

        <Section>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            Save company settings
          </button>
        </Section>
      </Form>
    </SettingsLayout>
  </AppLayout>
</template>
