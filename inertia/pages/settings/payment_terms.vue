<script setup lang="ts">
import { t } from '~/i18n'
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import { PAYMENT_METHODS } from '@shared/payments'

defineProps<{
  paymentTerms: {
    id: number
    name: string
    days: number
    endOfMonth: boolean
    paymentMethod: string
    customerCount: number
  }[]
}>()
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section :title="t('ui.paymentTerms.title')" :description="t('ui.paymentTerms.description')">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.paymentTerms.name') }}</th>
              <th>{{ t('ui.paymentTerms.days') }}</th>
              <th>{{ t('ui.paymentTerms.endOfMonth') }}</th>
              <th>{{ t('ui.paymentTerms.customers') }}</th>
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
                    :aria-label="t('ui.paymentTerms.nameOf', { name: terms.name })"
                    :style="{ maxWidth: '200px' }"
                  />
                  <input
                    name="days"
                    type="number"
                    min="0"
                    max="365"
                    class="field__input"
                    :value="terms.days"
                    :aria-label="t('ui.paymentTerms.daysFor', { name: terms.name })"
                    :style="{ maxWidth: '90px' }"
                  />
                  <label :style="{ display: 'flex', gap: '6px', alignItems: 'center' }">
                    <input
                      type="checkbox"
                      name="endOfMonth"
                      value="true"
                      :checked="terms.endOfMonth"
                    />
                    {{ t('ui.paymentTerms.endOfMonth') }}
                  </label>
                  <select
                    name="paymentMethod"
                    class="field__input"
                    :aria-label="t('ui.paymentTerms.paymentMethodOf', { name: terms.name })"
                    :style="{ maxWidth: '200px' }"
                  >
                    <option
                      v-for="method in PAYMENT_METHODS"
                      :key="method"
                      :value="method"
                      :selected="method === terms.paymentMethod"
                    >
                      {{ t(`ui.paymentMethods.${method}`) }}
                    </option>
                  </select>
                  <span :style="{ color: 'var(--subtle)' }">{{
                    t('ui.paymentTerms.customerCount', { count: terms.customerCount })
                  }}</span>
                  <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
                    {{ t('ui.common.save') }}
                  </button>
                  <!-- Away from their inputs, so naming them -->
                  <span v-if="errors.name" class="field__error">
                    {{
                      t('ui.common.fieldError', {
                        field: t('ui.paymentTerms.name'),
                        message: errors.name,
                      })
                    }}
                  </span>
                  <span v-if="errors.days" class="field__error">
                    {{
                      t('ui.common.fieldError', {
                        field: t('ui.paymentTerms.days'),
                        message: errors.days,
                      })
                    }}
                  </span>
                </Form>
              </td>
              <td class="table__actions">
                <Form
                  v-if="terms.customerCount === 0"
                  route="payment_terms.destroy"
                  :params="{ id: terms.id }"
                >
                  <button type="submit" class="btn btn--ghost btn--sm">
                    {{ t('ui.common.delete') }}
                  </button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section
        :title="t('ui.paymentTerms.addTitle')"
        :description="t('ui.paymentTerms.addDescription')"
      >
        <Form
          v-slot="{ processing, errors }"
          route="payment_terms.store"
          :style="{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }"
        >
          <div class="field">
            <label class="field__label" for="new-name">{{ t('ui.paymentTerms.name') }}</label>
            <input id="new-name" name="name" class="field__input" />
            <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-days">{{ t('ui.paymentTerms.days') }}</label>
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
            <input type="checkbox" name="endOfMonth" value="true" />
            {{ t('ui.paymentTerms.endOfMonth') }}
          </label>
          <div class="field">
            <label class="field__label" for="new-method">{{
              t('ui.paymentTerms.paymentMethod')
            }}</label>
            <select id="new-method" name="paymentMethod" class="field__input">
              <option
                v-for="method in PAYMENT_METHODS"
                :key="method"
                :value="method"
                :selected="method === 'MP05'"
              >
                {{ t(`ui.paymentMethods.${method}`) }}
              </option>
            </select>
          </div>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="processing"
            :style="{ marginTop: '22px' }"
          >
            {{ t('ui.paymentTerms.add') }}
          </button>
        </Form>
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
