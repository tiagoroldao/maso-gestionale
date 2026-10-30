<script setup lang="ts">
/**
 * The company's details, the settings area's home (docs/ui.md "Settings"):
 * a screen in edit mode, its sections one form that the header's primary
 * action saves.
 */
import { ref } from 'vue'
import { t } from '~/i18n'
import { Form } from '@adonisjs/inertia/vue'
import { urlFor } from '~/client'
import { cn } from '~/lib/utils'
import AppLayout from '~/layouts/app.vue'
import { LIQUIDATION_STATUSES, SOLE_SHAREHOLDER } from '@shared/company'
import type { ScreenAction } from '@shared/screen_actions'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import { buttonVariants } from '~/components/ui/button'
import SettingsScreen from '~/components/screen/settings_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import FormField from '~/components/screen/form_field.vue'
import { TOUCH } from '~/components/screen/screen'

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
  // Save, submitting the form
  actions: ScreenAction[]
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

const taxRegime = ref(props.settings.taxRegime ?? 'RF01')
const soleShareholder = ref(props.settings.soleShareholder ?? '')
const liquidationStatus = ref(props.settings.liquidationStatus)
</script>

<template>
  <AppLayout>
    <SettingsScreen route="company_settings.edit" :actions="actions">
      <Form
        id="company-settings"
        v-slot="{ errors }"
        route="company_settings.update"
        class="flex flex-col gap-3 md:gap-5"
      >
        <ScreenSection
          v-for="section in sections"
          :key="section.key"
          :title="section.title"
          :description="section.description"
        >
          <div class="grid gap-4 md:grid-cols-2">
            <FormField
              v-for="field in section.fields"
              :id="field.name"
              :key="field.name"
              v-slot="control"
              :label="field.label"
              :hint="field.hint"
              :error="errors[field.name]"
            >
              <Input
                :id="control.id"
                :name="field.name"
                :type="field.type ?? 'text'"
                :default-value="settings[field.name] ?? ''"
                :aria-invalid="control.invalid"
                :aria-describedby="control.describedBy"
                :class="TOUCH"
              />
            </FormField>

            <FormField
              v-if="section.key === 'company'"
              id="taxRegime"
              v-slot="control"
              :label="t('ui.company.taxRegime')"
              :error="errors.taxRegime"
            >
              <NativeSelect
                :id="control.id"
                v-model="taxRegime"
                name="taxRegime"
                :aria-invalid="control.invalid"
                :aria-describedby="control.describedBy"
              >
                <option v-for="(label, code) in taxRegimes" :key="code" :value="code">
                  {{ code }} – {{ label }}
                </option>
              </NativeSelect>
            </FormField>

            <template v-if="section.key === 'rea'">
              <FormField
                id="soleShareholder"
                v-slot="control"
                :label="t('ui.company.soleShareholder')"
                :error="errors.soleShareholder"
              >
                <NativeSelect
                  :id="control.id"
                  v-model="soleShareholder"
                  name="soleShareholder"
                  :aria-invalid="control.invalid"
                  :aria-describedby="control.describedBy"
                >
                  <option value="">{{ t('ui.company.notApplicable') }}</option>
                  <option v-for="code in SOLE_SHAREHOLDER" :key="code" :value="code">
                    {{ t(`ui.company.soleShareholders.${code}`) }}
                  </option>
                </NativeSelect>
              </FormField>
              <FormField
                id="liquidationStatus"
                v-slot="control"
                :label="t('ui.company.liquidationStatus')"
                :error="errors.liquidationStatus"
              >
                <NativeSelect
                  :id="control.id"
                  v-model="liquidationStatus"
                  name="liquidationStatus"
                  :aria-invalid="control.invalid"
                  :aria-describedby="control.describedBy"
                >
                  <option v-for="code in LIQUIDATION_STATUSES" :key="code" :value="code">
                    {{ t(`ui.company.liquidationStatuses.${code}`) }}
                  </option>
                </NativeSelect>
              </FormField>
            </template>
          </div>
        </ScreenSection>

        <ScreenSection
          :title="t('ui.company.logoSection')"
          :description="t('ui.company.logoDescription')"
        >
          <template #actions>
            <!-- A PDF, outside the app: a plain link, in a new tab -->
            <a
              :href="urlFor('letterhead_preview.pdf')"
              target="_blank"
              rel="noopener"
              :class="cn(buttonVariants({ variant: 'outline' }), TOUCH)"
            >
              {{ t('ui.company.previewLetterhead') }}
            </a>
          </template>
          <img
            v-if="settings.hasLogo"
            :src="logoUrl"
            :alt="t('ui.company.currentLogo')"
            class="max-h-20 max-w-60 self-start object-contain"
          />
          <FormField
            id="logo"
            v-slot="control"
            :label="settings.hasLogo ? t('ui.company.replaceLogo') : t('ui.company.uploadLogo')"
            :error="errors.logo"
          >
            <input
              :id="control.id"
              name="logo"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              :aria-invalid="errors.logo ? true : undefined"
              :aria-describedby="control.describedBy"
              class="text-sm file:mr-3 file:h-9 file:rounded-sm file:border file:border-solid file:border-border file:bg-card file:px-3 file:text-sm file:font-semibold file:text-foreground"
            />
          </FormField>
          <label
            v-if="settings.hasLogo"
            class="flex min-h-11 items-center gap-2.5 text-sm md:min-h-0"
          >
            <input type="checkbox" name="removeLogo" value="true" class="size-4" />
            {{ t('ui.company.removeLogo') }}
          </label>
        </ScreenSection>
      </Form>
    </SettingsScreen>
  </AppLayout>
</template>
