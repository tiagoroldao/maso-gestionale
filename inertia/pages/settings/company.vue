<script setup lang="ts">
import { t } from '~/i18n'
import { Form } from '@adonisjs/inertia/vue'
import { urlFor } from '~/client'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import { LIQUIDATION_STATUSES, SOLE_SHAREHOLDER } from '@shared/company'

type TextField =
  | 'name'
  | 'vatNumber'
  | 'taxCode'
  | 'street'
  | 'streetNumber'
  | 'postalCode'
  | 'city'
  | 'province'
  | 'reaOffice'
  | 'reaNumber'
  | 'shareCapital'
  | 'iban'
  | 'email'
  | 'phone'

const props = defineProps<{
  settings: Record<TextField | 'taxRegime' | 'soleShareholder', string | null> & {
    liquidationStatus: string
    hasLogo: boolean
    updatedAt: string | null
  }
  taxRegimes: Record<string, string>
}>()

type Field = { name: TextField; label: string; hint?: string; type?: string }

const sections: { key: string; title: string; description?: string; fields: Field[] }[] = [
  {
    key: 'company',
    title: t('ui.company.companySection'),
    fields: [
      { name: 'name', label: t('ui.company.name') },
      { name: 'vatNumber', label: t('ui.company.vatNumber') },
      {
        name: 'taxCode',
        label: t('ui.company.taxCode'),
        hint: t('ui.company.taxCodeHint'),
      },
    ],
  },
  {
    key: 'address',
    title: t('ui.company.addressSection'),
    fields: [
      { name: 'street', label: t('ui.address.street') },
      { name: 'streetNumber', label: t('ui.address.streetNumber') },
      { name: 'postalCode', label: t('ui.address.postalCode') },
      { name: 'city', label: t('ui.address.city') },
      { name: 'province', label: t('ui.address.province'), hint: t('ui.address.provinceHint') },
    ],
  },
  {
    key: 'rea',
    title: t('ui.company.reaSection'),
    description: t('ui.company.reaDescription'),
    fields: [
      { name: 'reaOffice', label: t('ui.company.reaOffice'), hint: t('ui.address.provinceHint') },
      { name: 'reaNumber', label: t('ui.company.reaNumber') },
      { name: 'shareCapital', label: t('ui.company.shareCapital') },
    ],
  },
  {
    key: 'contacts',
    title: t('ui.company.contactsSection'),
    description: t('ui.company.contactsDescription'),
    fields: [
      { name: 'iban', label: t('ui.company.iban') },
      { name: 'email', label: t('ui.company.email'), type: 'email' },
      { name: 'phone', label: t('ui.company.phone'), type: 'tel' },
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
          :key="section.key"
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

          <div v-if="section.key === 'company'" class="field">
            <label class="field__label" for="taxRegime">{{ t('ui.company.taxRegime') }}</label>
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

          <template v-if="section.key === 'rea'">
            <div class="field">
              <label class="field__label" for="soleShareholder">{{
                t('ui.company.soleShareholder')
              }}</label>
              <select
                id="soleShareholder"
                name="soleShareholder"
                class="field__input"
                :value="settings.soleShareholder ?? ''"
              >
                <option value="">{{ t('ui.company.notApplicable') }}</option>
                <option v-for="code in SOLE_SHAREHOLDER" :key="code" :value="code">
                  {{ t(`ui.company.soleShareholders.${code}`) }}
                </option>
              </select>
            </div>
            <div class="field">
              <label class="field__label" for="liquidationStatus">{{
                t('ui.company.liquidationStatus')
              }}</label>
              <select
                id="liquidationStatus"
                name="liquidationStatus"
                class="field__input"
                :value="settings.liquidationStatus"
              >
                <option v-for="code in LIQUIDATION_STATUSES" :key="code" :value="code">
                  {{ t(`ui.company.liquidationStatuses.${code}`) }}
                </option>
              </select>
            </div>
          </template>
        </Section>

        <Section
          :title="t('ui.company.logoSection')"
          :description="t('ui.company.logoDescription')"
        >
          <img
            v-if="settings.hasLogo"
            :src="logoUrl"
            :alt="t('ui.company.currentLogo')"
            :style="{ maxHeight: '80px', maxWidth: '240px', objectFit: 'contain' }"
          />
          <div class="field">
            <label class="field__label" for="logo">
              {{ settings.hasLogo ? t('ui.company.replaceLogo') : t('ui.company.uploadLogo') }}
            </label>
            <input id="logo" name="logo" type="file" accept=".png,.jpg,.jpeg,.webp" />
            <span v-if="errors.logo" class="field__error">{{ errors.logo }}</span>
          </div>
          <label
            v-if="settings.hasLogo"
            :style="{ display: 'flex', gap: '8px', alignItems: 'center' }"
          >
            <input type="checkbox" name="removeLogo" value="true" />
            {{ t('ui.company.removeLogo') }}
          </label>
        </Section>

        <Section>
          <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
            <button type="submit" class="btn btn--primary" :disabled="processing">
              {{ t('ui.company.save') }}
            </button>
            <a
              :href="urlFor('letterhead_preview.pdf')"
              target="_blank"
              rel="noopener"
              class="btn btn--secondary"
            >
              {{ t('ui.company.previewLetterhead') }}
            </a>
          </div>
        </Section>
      </Form>
    </SettingsLayout>
  </AppLayout>
</template>
