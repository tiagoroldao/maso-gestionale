<script setup lang="ts">
/**
 * Tariffe, a settings screen on the new UI (docs/ui.md "Settings"): the
 * Labour Rates edited in place, a new one added from the section's dialog,
 * and the Call-out Fee.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Form } from '@adonisjs/inertia/vue'
import { urlFor } from '~/client'
import AppLayout from '~/layouts/app.vue'
import { amountForInput } from '@shared/money'
import { t } from '~/i18n'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '~/components/ui/dialog'
import SettingsScreen from '~/components/screen/settings_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import ConfirmDialog from '~/components/screen/confirm_dialog.vue'
import FormField from '~/components/screen/form_field.vue'
import RowField from '~/components/screen/row_field.vue'
import RowHeads from '~/components/screen/row_heads.vue'
import RowErrors from '~/components/screen/row_errors.vue'
import { EDIT_ROW, EDIT_ROW_FORM, EMPTY, TOUCH } from '~/components/screen/screen'

defineProps<{
  labourRates: { id: number; name: string; hourlyPrice: string }[]
  callOutFee: string | null
}>()

const NAME = 'md:w-60'
const PRICE = 'md:w-32'
const addOpen = ref(false)

// Archiving can't be undone here, so it asks first (docs/ui.md "Settings")
const archiving = ref<{ id: number; name: string } | null>(null)
const archiveOpen = ref(false)
function askArchive(record: { id: number; name: string }) {
  archiving.value = record
  archiveOpen.value = true
}
function archive() {
  archiveOpen.value = false
  if (archiving.value) router.post(urlFor('rates.archive', { id: archiving.value.id }))
}
</script>

<template>
  <AppLayout>
    <SettingsScreen route="rates.index">
      <ScreenSection
        :title="t('ui.rates.labourTitle')"
        :description="t('ui.rates.labourDescription')"
        flush
      >
        <template #actions>
          <Button variant="outline" :class="TOUCH" @click="addOpen = true">
            {{ t('ui.rates.add') }}
          </Button>
        </template>
        <template v-if="labourRates.length">
          <RowHeads
            :heads="[
              { label: t('ui.rates.name'), class: NAME },
              { label: t('ui.rates.hourlyPrice'), class: PRICE },
            ]"
          />
          <ul class="m-0 list-none p-0">
            <li v-for="rate in labourRates" :key="rate.id" :class="EDIT_ROW">
              <Form
                v-slot="{ processing, errors }"
                route="rates.update"
                :params="{ id: rate.id }"
                :class="EDIT_ROW_FORM"
              >
                <RowField :label="t('ui.rates.name')" :class="NAME">
                  <Input
                    name="name"
                    :default-value="rate.name"
                    :aria-label="t('ui.rates.nameOf', { name: rate.name })"
                    :aria-invalid="errors.name ? 'true' : undefined"
                    :class="TOUCH"
                  />
                </RowField>
                <RowField :label="t('ui.rates.hourlyPrice')" :class="PRICE">
                  <Input
                    name="hourlyPrice"
                    inputmode="decimal"
                    :default-value="amountForInput(rate.hourlyPrice)"
                    :aria-label="t('ui.rates.priceOf', { name: rate.name })"
                    :aria-invalid="errors.hourlyPrice ? 'true' : undefined"
                    :class="TOUCH"
                  />
                </RowField>
                <Button type="submit" variant="outline" :class="TOUCH" :disabled="processing">
                  {{ t('ui.common.save') }}
                </Button>
                <RowErrors
                  :errors="errors"
                  :fields="{ name: t('ui.rates.name'), hourlyPrice: t('ui.rates.hourlyPrice') }"
                />
              </Form>
              <Button type="button" variant="ghost" :class="TOUCH" @click="askArchive(rate)">
                {{ t('ui.rates.archive') }}
              </Button>
            </li>
          </ul>
        </template>
        <p v-else :class="EMPTY">{{ t('ui.rates.empty') }}</p>
      </ScreenSection>

      <ScreenSection
        :title="t('ui.rates.callOutTitle')"
        :description="t('ui.rates.callOutDescription')"
      >
        <Form
          v-slot="{ processing, errors }"
          route="rates.update_call_out_fee"
          class="flex flex-col gap-3 md:flex-row md:items-start"
        >
          <FormField
            id="call-out-fee"
            v-slot="field"
            :label="t('ui.rates.callOutFee')"
            :error="errors.callOutFee"
            class="md:w-60"
          >
            <Input
              :id="field.id"
              name="callOutFee"
              inputmode="decimal"
              :default-value="callOutFee ? amountForInput(callOutFee) : ''"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
              :class="TOUCH"
            />
          </FormField>
          <Button
            type="submit"
            variant="outline"
            :class="[TOUCH, 'self-start md:mt-[22px]']"
            :disabled="processing"
          >
            {{ t('ui.common.save') }}
          </Button>
        </Form>
      </ScreenSection>
    </SettingsScreen>

    <Dialog v-model:open="addOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')" :aria-describedby="undefined">
        <DialogTitle>{{ t('ui.rates.add') }}</DialogTitle>
        <Form
          v-slot="{ processing, errors }"
          route="rates.store"
          reset-on-success
          class="flex flex-col gap-4"
          @success="addOpen = false"
        >
          <FormField
            id="new-rate-name"
            v-slot="field"
            :label="t('ui.rates.name')"
            :error="errors.name"
          >
            <Input
              :id="field.id"
              name="name"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
              :class="TOUCH"
            />
          </FormField>
          <FormField
            id="new-rate-price"
            v-slot="field"
            :label="t('ui.rates.hourlyPrice')"
            :error="errors.hourlyPrice"
          >
            <Input
              :id="field.id"
              name="hourlyPrice"
              inputmode="decimal"
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
              {{ t('ui.rates.add') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      v-model:open="archiveOpen"
      :title="t('ui.rates.archive')"
      :description="t('ui.rates.archiveConfirm', { name: archiving?.name ?? '' })"
      :confirm-label="t('ui.rates.archive')"
      @confirm="archive"
    />
  </AppLayout>
</template>
