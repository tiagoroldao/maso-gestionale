<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import { amountForInput } from '@shared/money'
import { NATURA_CODES } from '@shared/vat'
import { t } from '~/i18n'

type VatCode = {
  id: number
  name: string
  rate: string
  natura: string | null
  legalNote: string | null
  legalNoteTooLong: boolean
}

defineProps<{ vatCodes: VatCode[]; legalNoteMax: number }>()

const rowStyle = { display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }

// A row's errors show after its inputs, with the field each is about
const rowLabels = {
  name: t('ui.vatCodes.name'),
  rate: t('ui.vatCodes.rate'),
  natura: t('ui.vatCodes.natura'),
  legalNote: t('ui.vatCodes.legalNote'),
}
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section :title="t('ui.vatCodes.title')" :description="t('ui.vatCodes.description')">
        <table v-if="vatCodes.length" class="table">
          <tbody>
            <tr v-for="code in vatCodes" :key="code.id">
              <td>
                <Form
                  v-slot="{ processing, errors }"
                  route="vat_codes.update"
                  :params="{ id: code.id }"
                  :style="rowStyle"
                >
                  <input
                    name="name"
                    class="field__input"
                    :value="code.name"
                    :aria-label="t('ui.vatCodes.nameOf', { name: code.name })"
                    :style="{ maxWidth: '280px' }"
                  />
                  <input
                    name="rate"
                    inputmode="decimal"
                    class="field__input"
                    :value="amountForInput(code.rate)"
                    :aria-label="t('ui.vatCodes.rateOf', { name: code.name })"
                    :style="{ maxWidth: '80px' }"
                  />
                  <span class="field__hint">%</span>
                  <select
                    name="natura"
                    class="field__input"
                    :aria-label="t('ui.vatCodes.naturaOf', { name: code.name })"
                    :style="{ maxWidth: '100px' }"
                  >
                    <option value="" :selected="!code.natura">—</option>
                    <option
                      v-for="natura in NATURA_CODES"
                      :key="natura"
                      :value="natura"
                      :selected="code.natura === natura"
                    >
                      {{ natura }}
                    </option>
                  </select>
                  <input
                    name="legalNote"
                    class="field__input"
                    :value="code.legalNote ?? ''"
                    :placeholder="t('ui.vatCodes.legalNote')"
                    :aria-label="t('ui.vatCodes.legalNoteOf', { name: code.name })"
                  />
                  <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
                    {{ t('ui.common.save') }}
                  </button>
                  <span v-if="code.legalNoteTooLong" class="field__error">
                    {{ t('ui.vatCodes.legalNoteTooLong', { max: legalNoteMax }) }}
                  </span>
                  <!-- Away from their inputs, so naming them -->
                  <span v-for="(label, field) in rowLabels" :key="field">
                    <span v-if="errors[field]" class="field__error">
                      {{ t('ui.common.fieldError', { field: label, message: errors[field] }) }}
                    </span>
                  </span>
                </Form>
              </td>
              <td class="table__actions">
                <Form route="vat_codes.archive" :params="{ id: code.id }">
                  <button type="submit" class="btn btn--ghost btn--sm">
                    {{ t('ui.vatCodes.archive') }}
                  </button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.vatCodes.empty') }}</p>
      </Section>

      <Section :title="t('ui.vatCodes.addTitle')" :description="t('ui.vatCodes.naturaHint')">
        <Form v-slot="{ processing, errors }" route="vat_codes.store" reset-on-success>
          <div class="field">
            <label class="field__label" for="new-vat-name">{{ t('ui.vatCodes.name') }}</label>
            <input id="new-vat-name" name="name" class="field__input" />
            <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-vat-rate">{{ t('ui.vatCodes.rate') }}</label>
            <input
              id="new-vat-rate"
              name="rate"
              inputmode="decimal"
              class="field__input"
              :style="{ maxWidth: '120px' }"
            />
            <span v-if="errors.rate" class="field__error">{{ errors.rate }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-vat-natura">{{ t('ui.vatCodes.natura') }}</label>
            <select
              id="new-vat-natura"
              name="natura"
              class="field__input"
              :style="{ maxWidth: '120px' }"
            >
              <option value="">—</option>
              <option v-for="natura in NATURA_CODES" :key="natura" :value="natura">
                {{ natura }}
              </option>
            </select>
            <span v-if="errors.natura" class="field__error">{{ errors.natura }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-vat-note">{{ t('ui.vatCodes.legalNote') }}</label>
            <input id="new-vat-note" name="legalNote" class="field__input" />
            <span class="field__hint">{{ t('ui.vatCodes.legalNoteHint') }}</span>
            <span v-if="errors.legalNote" class="field__error">{{ errors.legalNote }}</span>
          </div>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.vatCodes.add') }}
          </button>
        </Form>
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
