<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import { t } from '~/i18n'

defineProps<{ years: { year: number; nextNumber: number; locked: boolean }[] }>()
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section
        :title="t('ui.invoiceNumbering.title')"
        :description="t('ui.invoiceNumbering.description')"
      >
        <Form
          v-for="entry in years"
          :key="entry.year"
          v-slot="{ processing, errors }"
          route="invoice_numbering.update"
          :params="{ year: entry.year }"
          class="field"
        >
          <label class="field__label" :for="`next-${entry.year}`">
            {{ t('ui.invoiceNumbering.nextNumber', { year: entry.year }) }}
          </label>
          <div :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
            <input
              :id="`next-${entry.year}`"
              name="nextNumber"
              type="number"
              min="1"
              class="field__input"
              :value="entry.nextNumber"
              :disabled="entry.locked"
              :style="{ maxWidth: '140px' }"
            />
            <button
              v-if="!entry.locked"
              type="submit"
              class="btn btn--secondary btn--sm"
              :disabled="processing"
            >
              {{ t('ui.common.save') }}
            </button>
          </div>
          <span class="field__hint">
            {{ entry.locked ? t('ui.invoiceNumbering.locked') : t('ui.invoiceNumbering.hint') }}
          </span>
          <span v-if="errors.nextNumber" class="field__error">{{ errors.nextNumber }}</span>
        </Form>
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
