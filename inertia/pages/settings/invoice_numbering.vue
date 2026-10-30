<script setup lang="ts">
/**
 * Numerazione fatture, a settings screen on the new UI (docs/ui.md
 * "Settings"): each year's next number, the Credit Notes' numbering and the
 * SDI files' letter, each a short form of its own section.
 */
import { ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { t } from '~/i18n'
import { CREDIT_NOTE_NUMBERING_MODES, type CreditNoteNumberingMode } from '@shared/credit_notes'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import SettingsScreen from '~/components/screen/settings_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import FormField from '~/components/screen/form_field.vue'
import { TOUCH } from '~/components/screen/screen'

const props = defineProps<{
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

const mode = ref<string>(props.creditNotes.next)

const FORM = 'flex flex-col gap-3 md:flex-row md:items-start'
const SAVE = [TOUCH, 'self-start md:mt-[22px]']
</script>

<template>
  <AppLayout>
    <SettingsScreen route="invoice_numbering.index">
      <ScreenSection
        :title="t('ui.invoiceNumbering.title')"
        :description="t('ui.invoiceNumbering.description')"
      >
        <Form
          v-for="entry in years"
          :key="entry.year"
          v-slot="{ processing, errors }"
          route="invoice_numbering.update"
          :params="{ year: entry.year }"
          :class="FORM"
        >
          <FormField
            :id="`next-${entry.year}`"
            v-slot="field"
            :label="t('ui.invoiceNumbering.nextNumber', { year: entry.year })"
            :hint="entry.locked ? t('ui.invoiceNumbering.locked') : t('ui.invoiceNumbering.hint')"
            :error="errors.nextNumber"
            class="md:w-96"
          >
            <Input
              :id="field.id"
              name="nextNumber"
              type="number"
              min="1"
              :default-value="entry.nextNumber"
              :disabled="entry.locked"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
              :class="[TOUCH, 'md:w-36']"
            />
          </FormField>
          <Button
            v-if="!entry.locked"
            type="submit"
            variant="outline"
            :class="SAVE"
            :disabled="processing"
          >
            {{ t('ui.common.save') }}
          </Button>
        </Form>
      </ScreenSection>

      <ScreenSection
        :title="t('ui.invoiceNumbering.creditNotes')"
        :description="t('ui.invoiceNumbering.creditNotesDescription')"
      >
        <p class="m-0 text-sm">
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
          :class="FORM"
        >
          <FormField
            id="credit-note-mode"
            v-slot="field"
            :label="t('ui.invoiceNumbering.creditNotes')"
            :error="errors.mode"
            class="md:w-96"
          >
            <NativeSelect
              :id="field.id"
              v-model="mode"
              name="mode"
              :aria-invalid="field.invalid"
              aria-describedby="credit-note-mode-warning"
            >
              <option v-for="option in CREDIT_NOTE_NUMBERING_MODES" :key="option" :value="option">
                {{ t(`ui.invoiceNumbering.creditNotesModes.${option}`) }}
              </option>
            </NativeSelect>
          </FormField>
          <Button type="submit" variant="outline" :class="SAVE" :disabled="processing">
            {{ t('ui.common.save') }}
          </Button>
        </Form>
        <p
          id="credit-note-mode-warning"
          class="m-0 text-[13px] text-muted-foreground"
          data-testid="credit-note-numbering-warning"
        >
          {{ t('ui.invoiceNumbering.creditNotesWarning') }}
        </p>
      </ScreenSection>

      <ScreenSection
        :title="t('ui.invoiceNumbering.sdiPrefix')"
        :description="t('ui.invoiceNumbering.sdiPrefixHint')"
      >
        <Form
          v-slot="{ processing, errors }"
          route="invoice_numbering.update_sdi_prefix"
          :class="FORM"
        >
          <FormField
            id="sdi-prefix"
            v-slot="field"
            :label="t('ui.invoiceNumbering.sdiPrefix')"
            :error="errors.sdiFilePrefix"
            class="md:w-96"
          >
            <Input
              :id="field.id"
              name="sdiFilePrefix"
              maxlength="1"
              :default-value="sdiFilePrefix"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
              :class="[TOUCH, 'w-16 font-mono']"
            />
          </FormField>
          <Button type="submit" variant="outline" :class="SAVE" :disabled="processing">
            {{ t('ui.common.save') }}
          </Button>
        </Form>
      </ScreenSection>
    </SettingsScreen>
  </AppLayout>
</template>
