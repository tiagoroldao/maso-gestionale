<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { t } from '~/i18n'

type DetailField =
  'name' | 'taxCode' | 'street' | 'postalCode' | 'city' | 'province' | 'email' | 'phone'

const props = defineProps<{
  // Null for a new Supplier
  supplier:
    | (Record<DetailField, string | null> & { id: number; vatCountry: string; vatNumber: string })
    | null
}>()

const fields: { name: DetailField; maxWidth: string }[] = [
  { name: 'name', maxWidth: '420px' },
  { name: 'taxCode', maxWidth: '240px' },
  { name: 'street', maxWidth: '420px' },
  { name: 'postalCode', maxWidth: '120px' },
  { name: 'city', maxWidth: '320px' },
  { name: 'province', maxWidth: '80px' },
  { name: 'email', maxWidth: '320px' },
  { name: 'phone', maxWidth: '240px' },
]
const value = (field: DetailField) => props.supplier?.[field] ?? ''
</script>

<template>
  <AppLayout>
    <Page
      :title="
        supplier ? t('ui.suppliers.editTitle', { name: supplier.name }) : t('ui.suppliers.newTitle')
      "
    >
      <Form
        v-slot="{ processing, errors }"
        :route="supplier ? 'suppliers.update' : 'suppliers.store'"
        :params="supplier ? { id: supplier.id } : undefined"
      >
        <Section>
          <div v-if="supplier" class="field">
            <span class="field__label">{{ t('ui.suppliers.vatNumber') }}</span>
            <span class="mono">{{ supplier.vatCountry }}{{ supplier.vatNumber }}</span>
            <span class="field__hint">{{ t('ui.suppliers.vatNumberFixed') }}</span>
          </div>
          <div v-else :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
            <div class="field" :style="{ maxWidth: '80px' }">
              <label class="field__label" for="supplier-vatCountry">
                {{ t('ui.suppliers.vatCountry') }}
              </label>
              <input id="supplier-vatCountry" name="vatCountry" class="field__input" value="IT" />
              <span v-if="errors.vatCountry" class="field__error">{{ errors.vatCountry }}</span>
            </div>
            <div class="field" :style="{ maxWidth: '240px' }">
              <label class="field__label" for="supplier-vatNumber">
                {{ t('ui.suppliers.vatNumber') }}
              </label>
              <input id="supplier-vatNumber" name="vatNumber" class="field__input mono" />
              <span v-if="errors.vatNumber" class="field__error">{{ errors.vatNumber }}</span>
            </div>
          </div>

          <div
            v-for="field in fields"
            :key="field.name"
            class="field"
            :style="{ maxWidth: field.maxWidth }"
          >
            <label class="field__label" :for="`supplier-${field.name}`">
              {{ t(`ui.suppliers.${field.name}`) }}
            </label>
            <input
              :id="`supplier-${field.name}`"
              :name="field.name"
              class="field__input"
              :value="value(field.name)"
            />
            <span v-if="errors[field.name]" class="field__error">{{ errors[field.name] }}</span>
          </div>

          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ supplier ? t('ui.suppliers.save') : t('ui.suppliers.create') }}
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
