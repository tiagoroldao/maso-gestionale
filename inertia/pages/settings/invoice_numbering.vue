<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import { t } from '~/i18n'
import { CREDIT_NOTE_NUMBERING_MODES, type CreditNoteNumberingMode } from '@shared/credit_notes'

defineProps<{
  years: { year: number; nextNumber: number; locked: boolean }[]
  sdiFilePrefix: string
  // This year's mode and next year's; a change applies at once while no
  // Credit Note has been numbered this year
  creditNotes: {
    year: number
    current: CreditNoteNumberingMode
    next: CreditNoteNumberingMode
    changesNow: boolean
  }
}>()
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

      <Section
        :title="t('ui.invoiceNumbering.creditNotes')"
        :description="t('ui.invoiceNumbering.creditNotesDescription')"
      >
        <p>
          {{
            t('ui.invoiceNumbering.creditNotesCurrent', {
              year: creditNotes.year,
              mode: t(`ui.invoiceNumbering.creditNotesModes.${creditNotes.current}`),
            })
          }}
          <template v-if="creditNotes.next !== creditNotes.current">
            {{
              t('ui.invoiceNumbering.creditNotesNext', {
                year: creditNotes.year + 1,
                mode: t(`ui.invoiceNumbering.creditNotesModes.${creditNotes.next}`),
              })
            }}
          </template>
        </p>
        <Form
          v-slot="{ processing, errors }"
          route="invoice_numbering.update_credit_notes"
          class="field"
        >
          <label class="field__label" for="credit-note-mode">{{
            t('ui.invoiceNumbering.creditNotes')
          }}</label>
          <div :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
            <select
              id="credit-note-mode"
              name="mode"
              class="field__input"
              :value="creditNotes.next"
              :style="{ maxWidth: '300px' }"
            >
              <option v-for="mode in CREDIT_NOTE_NUMBERING_MODES" :key="mode" :value="mode">
                {{ t(`ui.invoiceNumbering.creditNotesModes.${mode}`) }}
              </option>
            </select>
            <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
              {{ t('ui.common.save') }}
            </button>
          </div>
          <span class="field__hint" data-testid="credit-note-numbering-warning">
            {{ t('ui.invoiceNumbering.creditNotesWarning') }}
          </span>
          <span v-if="errors.mode" class="field__error">{{ errors.mode }}</span>
        </Form>
      </Section>

      <Section
        :title="t('ui.invoiceNumbering.sdiPrefix')"
        :description="t('ui.invoiceNumbering.sdiPrefixHint')"
      >
        <Form
          v-slot="{ processing, errors }"
          route="invoice_numbering.update_sdi_prefix"
          class="field"
        >
          <label class="field__label" for="sdi-prefix">{{
            t('ui.invoiceNumbering.sdiPrefix')
          }}</label>
          <div :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
            <input
              id="sdi-prefix"
              name="sdiFilePrefix"
              maxlength="1"
              class="field__input mono"
              :value="sdiFilePrefix"
              :style="{ maxWidth: '60px' }"
            />
            <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
              {{ t('ui.common.save') }}
            </button>
          </div>
          <span v-if="errors.sdiFilePrefix" class="field__error">{{ errors.sdiFilePrefix }}</span>
        </Form>
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
