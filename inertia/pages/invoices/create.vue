<script setup lang="ts">
import { ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import CustomerPicker, { type PickedCustomer } from '~/components/customer_picker.vue'
import { t } from '~/i18n'

const customer = ref<PickedCustomer | null>(null)
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.invoices.newTitle')" :description="t('ui.invoices.newDescription')">
      <Form v-slot="{ processing, errors }" route="invoices.store">
        <Section :title="t('ui.invoices.customer')">
          <input type="hidden" name="customerId" :value="customer?.id ?? ''" />
          <div v-if="customer" :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
            <strong>{{ customer.displayName }}</strong>
            <button type="button" class="btn btn--ghost btn--sm" @click="customer = null">
              {{ t('ui.invoices.changeCustomer') }}
            </button>
          </div>
          <CustomerPicker v-else @select="(picked) => (customer = picked)" />
          <span v-if="errors.customerId" class="field__error">{{ errors.customerId }}</span>
        </Section>
        <Section>
          <button type="submit" class="btn btn--primary" :disabled="processing || !customer">
            {{ t('ui.invoices.create') }}
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
