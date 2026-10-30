<script setup lang="ts">
/**
 * Codici IVA, a settings screen on the new UI (docs/ui.md "Settings"): the
 * VAT Codes edited in place, a new one added from the section's dialog.
 */
import { ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import { amountForInput } from '@shared/money'
import { NATURA_CODES } from '@shared/vat'
import { t } from '~/i18n'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import SettingsScreen from '~/components/screen/settings_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import FormField from '~/components/screen/form_field.vue'
import RowField from '~/components/screen/row_field.vue'
import RowHeads from '~/components/screen/row_heads.vue'
import RowErrors from '~/components/screen/row_errors.vue'
import { EDIT_ROW, EDIT_ROW_FORM, EMPTY, TOUCH } from '~/components/screen/screen'

type VatCode = {
  id: number
  name: string
  rate: string
  natura: string | null
  legalNote: string | null
  legalNoteTooLong: boolean
}

defineProps<{ vatCodes: VatCode[]; legalNoteMax: number }>()

const NAME = 'md:w-56'
const RATE = 'md:w-24'
const NATURA = 'md:w-28'
const NOTE = 'md:w-64'

// A row's errors show after its inputs, with the field each is about
const rowLabels = {
  name: t('ui.vatCodes.name'),
  rate: t('ui.vatCodes.rate'),
  natura: t('ui.vatCodes.natura'),
  legalNote: t('ui.vatCodes.legalNote'),
}

const addOpen = ref(false)
const newNatura = ref('')
function added() {
  addOpen.value = false
  newNatura.value = ''
}
</script>

<template>
  <AppLayout>
    <SettingsScreen route="vat_codes.index">
      <ScreenSection
        :title="t('ui.vatCodes.title')"
        :description="t('ui.vatCodes.description')"
        flush
      >
        <template #actions>
          <Button variant="outline" :class="TOUCH" @click="addOpen = true">
            {{ t('ui.vatCodes.add') }}
          </Button>
        </template>
        <template v-if="vatCodes.length">
          <RowHeads
            :heads="[
              { label: rowLabels.name, class: NAME },
              { label: rowLabels.rate, class: RATE },
              { label: rowLabels.natura, class: NATURA },
              { label: rowLabels.legalNote, class: NOTE },
            ]"
          />
          <ul class="m-0 list-none p-0">
            <li v-for="code in vatCodes" :key="code.id" :class="EDIT_ROW">
              <Form
                v-slot="{ processing, errors }"
                route="vat_codes.update"
                :params="{ id: code.id }"
                :class="EDIT_ROW_FORM"
              >
                <RowField :label="rowLabels.name" :class="NAME">
                  <Input
                    name="name"
                    :default-value="code.name"
                    :aria-label="t('ui.vatCodes.nameOf', { name: code.name })"
                    :aria-invalid="errors.name ? 'true' : undefined"
                    :class="TOUCH"
                  />
                </RowField>
                <RowField :label="rowLabels.rate" :class="RATE">
                  <Input
                    name="rate"
                    inputmode="decimal"
                    :default-value="amountForInput(code.rate)"
                    :aria-label="t('ui.vatCodes.rateOf', { name: code.name })"
                    :aria-invalid="errors.rate ? 'true' : undefined"
                    :class="TOUCH"
                  />
                </RowField>
                <RowField :label="rowLabels.natura" :class="NATURA">
                  <NativeSelect
                    name="natura"
                    :model-value="code.natura ?? ''"
                    :aria-label="t('ui.vatCodes.naturaOf', { name: code.name })"
                    :aria-invalid="errors.natura ? 'true' : undefined"
                  >
                    <option value="">—</option>
                    <option v-for="natura in NATURA_CODES" :key="natura" :value="natura">
                      {{ natura }}
                    </option>
                  </NativeSelect>
                </RowField>
                <RowField :label="rowLabels.legalNote" :class="NOTE">
                  <Input
                    name="legalNote"
                    :default-value="code.legalNote ?? ''"
                    :aria-label="t('ui.vatCodes.legalNoteOf', { name: code.name })"
                    :aria-invalid="errors.legalNote || code.legalNoteTooLong ? 'true' : undefined"
                    :class="TOUCH"
                  />
                </RowField>
                <Button type="submit" variant="outline" :class="TOUCH" :disabled="processing">
                  {{ t('ui.common.save') }}
                </Button>
                <p
                  v-if="code.legalNoteTooLong"
                  class="m-0 flex w-full items-start gap-1.5 text-sm text-destructive"
                >
                  <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
                  {{ t('ui.vatCodes.legalNoteTooLong', { max: legalNoteMax }) }}
                </p>
                <RowErrors :errors="errors" :fields="rowLabels" />
              </Form>
              <Form route="vat_codes.archive" :params="{ id: code.id }">
                <Button type="submit" variant="ghost" :class="TOUCH">
                  {{ t('ui.vatCodes.archive') }}
                </Button>
              </Form>
            </li>
          </ul>
        </template>
        <p v-else :class="EMPTY">{{ t('ui.vatCodes.empty') }}</p>
      </ScreenSection>
    </SettingsScreen>

    <Dialog v-model:open="addOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.vatCodes.addTitle') }}</DialogTitle>
        <DialogDescription>{{ t('ui.vatCodes.naturaHint') }}</DialogDescription>
        <Form
          v-slot="{ processing, errors }"
          route="vat_codes.store"
          class="flex flex-col gap-4"
          @success="added"
        >
          <FormField id="new-vat-name" v-slot="field" :label="rowLabels.name" :error="errors.name">
            <Input
              :id="field.id"
              name="name"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
              :class="TOUCH"
            />
          </FormField>
          <div class="grid grid-cols-2 gap-3">
            <FormField
              id="new-vat-rate"
              v-slot="field"
              :label="rowLabels.rate"
              :error="errors.rate"
            >
              <Input
                :id="field.id"
                name="rate"
                inputmode="decimal"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
            <FormField
              id="new-vat-natura"
              v-slot="field"
              :label="rowLabels.natura"
              :error="errors.natura"
            >
              <NativeSelect
                :id="field.id"
                v-model="newNatura"
                name="natura"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              >
                <option value="">—</option>
                <option v-for="natura in NATURA_CODES" :key="natura" :value="natura">
                  {{ natura }}
                </option>
              </NativeSelect>
            </FormField>
          </div>
          <FormField
            id="new-vat-note"
            v-slot="field"
            :label="rowLabels.legalNote"
            :hint="t('ui.vatCodes.legalNoteHint')"
            :error="errors.legalNote"
          >
            <Input
              :id="field.id"
              name="legalNote"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
              :class="TOUCH"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="TOUCH" @click="addOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="TOUCH" :disabled="processing">
              {{ t('ui.vatCodes.add') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  </AppLayout>
</template>
