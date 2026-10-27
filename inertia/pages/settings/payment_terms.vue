<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'

defineProps<{
  paymentTerms: {
    id: number
    name: string
    days: number
    endOfMonth: boolean
    customerCount: number
  }[]
}>()
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section
        title="Payment Terms"
        description="Each Customer has Payment Terms, which set the due date of their invoices."
      >
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Days</th>
              <th>End of month</th>
              <th>Customers</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="terms in paymentTerms" :key="terms.id">
              <td colspan="4">
                <Form
                  v-slot="{ processing, errors }"
                  route="payment_terms.update"
                  :params="{ id: terms.id }"
                  :style="{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }"
                >
                  <input
                    name="name"
                    class="field__input"
                    :value="terms.name"
                    :aria-label="`Name of ${terms.name}`"
                    :style="{ maxWidth: '200px' }"
                  />
                  <input
                    name="days"
                    type="number"
                    min="0"
                    max="365"
                    class="field__input"
                    :value="terms.days"
                    :aria-label="`Days for ${terms.name}`"
                    :style="{ maxWidth: '90px' }"
                  />
                  <label :style="{ display: 'flex', gap: '6px', alignItems: 'center' }">
                    <input
                      type="checkbox"
                      name="endOfMonth"
                      value="true"
                      :checked="terms.endOfMonth"
                    />
                    End of month
                  </label>
                  <span :style="{ color: 'var(--subtle)' }"
                    >{{ terms.customerCount }}
                    {{ terms.customerCount === 1 ? 'customer' : 'customers' }}</span
                  >
                  <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
                    Save
                  </button>
                  <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
                  <span v-if="errors.days" class="field__error">{{ errors.days }}</span>
                </Form>
              </td>
              <td class="table__actions">
                <Form
                  v-if="terms.customerCount === 0"
                  route="payment_terms.destroy"
                  :params="{ id: terms.id }"
                >
                  <button type="submit" class="btn btn--ghost btn--sm">Delete</button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Add Payment Terms" description="For example “30 days end of month”.">
        <Form
          v-slot="{ processing, errors }"
          route="payment_terms.store"
          :style="{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }"
        >
          <div class="field">
            <label class="field__label" for="new-name">Name</label>
            <input id="new-name" name="name" class="field__input" />
            <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-days">Days</label>
            <input
              id="new-days"
              name="days"
              type="number"
              min="0"
              max="365"
              class="field__input"
              value="30"
            />
            <span v-if="errors.days" class="field__error">{{ errors.days }}</span>
          </div>
          <label :style="{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '28px' }">
            <input type="checkbox" name="endOfMonth" value="true" /> End of month
          </label>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="processing"
            :style="{ marginTop: '22px' }"
          >
            Add
          </button>
        </Form>
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
