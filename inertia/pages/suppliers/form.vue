<script setup lang="ts">
/**
 * A Supplier in edit mode (docs/ui.md "Kinds of screen"): the screen
 * wrapped in its form, Save its primary action. A Supplier has no page of
 * its own, so it sits under Fornitori. Its VAT number is typed once, when
 * it is created: its invoices carry it.
 */
import { Form } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { t } from '~/i18n'
import { urlFor } from '~/client'
import type { ScreenAction } from '@shared/screen_actions'
import { Input } from '~/components/ui/input'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import FormField from '~/components/screen/form_field.vue'

type DetailField =
  'name' | 'taxCode' | 'street' | 'postalCode' | 'city' | 'province' | 'email' | 'phone'

const props = defineProps<{
  // Save, the screen's primary
  actions: ScreenAction[]
  // Null for a new Supplier
  supplier:
    | (Record<DetailField, string | null> & { id: number; vatCountry: string; vatNumber: string })
    | null
}>()

const value = (field: DetailField) => props.supplier?.[field] ?? ''
const sections: { key: string; fields: DetailField[] }[] = [
  { key: 'addressSection', fields: ['street', 'postalCode', 'city', 'province'] },
  { key: 'contactsSection', fields: ['email', 'phone'] },
]

const title = props.supplier?.name ?? t('ui.suppliers.newTitle')
const vatId = props.supplier ? `${props.supplier.vatCountry}${props.supplier.vatNumber}` : ''

const GRID = 'grid gap-4 md:grid-cols-2'
const INPUT = 'h-11 md:h-9'
</script>

<template>
  <AppLayout>
    <Form
      id="supplier-form"
      v-slot="{ errors }"
      :route="supplier ? 'suppliers.update' : 'suppliers.store'"
      :params="supplier ? { id: supplier.id } : undefined"
      class="w-full min-w-0"
    >
      <EntityScreen
        :document-title="supplier ? t('ui.suppliers.editTitle', { name: supplier.name }) : title"
        :crumbs="[{ label: t('ui.suppliers.title'), href: urlFor('suppliers.index') }]"
        :current="title"
        :title="title"
        :facts="vatId"
        :actions="actions"
      >
        <template #main>
          <ScreenSection :title="t('ui.suppliers.companySection')">
            <div v-if="!supplier" class="grid grid-cols-[96px_1fr] gap-4">
              <FormField
                id="supplier-vatCountry"
                v-slot="field"
                :label="t('ui.suppliers.vatCountry')"
                :error="errors.vatCountry"
              >
                <Input
                  :id="field.id"
                  name="vatCountry"
                  default-value="IT"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
              <FormField
                id="supplier-vatNumber"
                v-slot="field"
                :label="t('ui.suppliers.vatNumber')"
                :hint="t('ui.suppliers.vatNumberFixed')"
                :error="errors.vatNumber"
              >
                <Input
                  :id="field.id"
                  name="vatNumber"
                  :class="[INPUT, 'font-mono']"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </div>
            <p v-else class="m-0 text-[13px] text-muted-foreground">
              {{ t('ui.suppliers.vatNumberFixed') }}
            </p>
            <div :class="GRID">
              <FormField
                v-for="name in ['name', 'taxCode'] as const"
                :id="`supplier-${name}`"
                :key="name"
                v-slot="field"
                :label="t(`ui.suppliers.${name}`)"
                :error="errors[name]"
              >
                <Input
                  :id="field.id"
                  :name="name"
                  :default-value="value(name)"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </div>
          </ScreenSection>

          <ScreenSection
            v-for="section in sections"
            :key="section.key"
            :title="t(`ui.suppliers.${section.key}`)"
          >
            <div :class="GRID">
              <FormField
                v-for="name in section.fields"
                :id="`supplier-${name}`"
                :key="name"
                v-slot="field"
                :label="t(`ui.suppliers.${name}`)"
                :error="errors[name]"
              >
                <Input
                  :id="field.id"
                  :name="name"
                  :default-value="value(name)"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </div>
          </ScreenSection>
        </template>
      </EntityScreen>
    </Form>
  </AppLayout>
</template>
