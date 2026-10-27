<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import { amountForInput } from '@shared/money'
import { t } from '~/i18n'

defineProps<{
  labourRates: { id: number; name: string; hourlyPrice: string }[]
  callOutFee: string | null
}>()
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section :title="t('ui.rates.labourTitle')" :description="t('ui.rates.labourDescription')">
        <table v-if="labourRates.length" class="table">
          <tbody>
            <tr v-for="rate in labourRates" :key="rate.id">
              <td>
                <Form
                  v-slot="{ processing, errors }"
                  route="rates.update"
                  :params="{ id: rate.id }"
                  :style="{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }"
                >
                  <input
                    name="name"
                    class="field__input"
                    :value="rate.name"
                    :aria-label="t('ui.rates.nameOf', { name: rate.name })"
                    :style="{ maxWidth: '240px' }"
                  />
                  <input
                    name="hourlyPrice"
                    inputmode="decimal"
                    class="field__input"
                    :value="amountForInput(rate.hourlyPrice)"
                    :aria-label="t('ui.rates.priceOf', { name: rate.name })"
                    :style="{ maxWidth: '120px' }"
                  />
                  <span class="field__hint">€/h</span>
                  <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
                    {{ t('ui.common.save') }}
                  </button>
                  <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
                  <span v-if="errors.hourlyPrice" class="field__error">{{
                    errors.hourlyPrice
                  }}</span>
                </Form>
              </td>
              <td class="table__actions">
                <Form route="rates.archive" :params="{ id: rate.id }">
                  <button type="submit" class="btn btn--ghost btn--sm">
                    {{ t('ui.rates.archive') }}
                  </button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.rates.empty') }}</p>

        <Form
          v-slot="{ processing, errors }"
          route="rates.store"
          reset-on-success
          :style="{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }"
        >
          <div class="field">
            <label class="field__label" for="new-rate-name">{{ t('ui.rates.name') }}</label>
            <input id="new-rate-name" name="name" class="field__input" />
            <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-rate-price">{{ t('ui.rates.hourlyPrice') }}</label>
            <input
              id="new-rate-price"
              name="hourlyPrice"
              inputmode="decimal"
              class="field__input"
            />
            <span v-if="errors.hourlyPrice" class="field__error">{{ errors.hourlyPrice }}</span>
          </div>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="processing"
            :style="{ marginTop: '22px' }"
          >
            {{ t('ui.rates.add') }}
          </button>
        </Form>
      </Section>

      <Section :title="t('ui.rates.callOutTitle')" :description="t('ui.rates.callOutDescription')">
        <Form
          v-slot="{ processing, errors }"
          route="rates.update_call_out_fee"
          :style="{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }"
        >
          <div class="field">
            <label class="field__label" for="call-out-fee">{{ t('ui.rates.callOutFee') }}</label>
            <input
              id="call-out-fee"
              name="callOutFee"
              inputmode="decimal"
              class="field__input"
              :value="callOutFee ? amountForInput(callOutFee) : ''"
            />
            <span v-if="errors.callOutFee" class="field__error">{{ errors.callOutFee }}</span>
          </div>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="processing"
            :style="{ marginTop: '22px' }"
          >
            {{ t('ui.common.save') }}
          </button>
        </Form>
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
