<script setup lang="ts">
/**
 * Condizioni di pagamento, a settings screen on the new UI (docs/ui.md
 * "Settings"): the Payment Terms edited in place, new ones added from the
 * section's dialog, and those no Customer has deleted, after confirming.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Form } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { PAYMENT_METHODS } from '@shared/payments'
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
import ConfirmDialog from '~/components/screen/confirm_dialog.vue'
import FormField from '~/components/screen/form_field.vue'
import RowField from '~/components/screen/row_field.vue'
import RowHeads from '~/components/screen/row_heads.vue'
import RowErrors from '~/components/screen/row_errors.vue'
import { EDIT_ROW, EDIT_ROW_FORM, TOUCH } from '~/components/screen/screen'

type Terms = {
  id: number
  name: string
  days: number
  endOfMonth: boolean
  paymentMethod: string
  customerCount: number
}

defineProps<{ paymentTerms: Terms[] }>()

const NAME = 'md:w-48'
const DAYS = 'md:w-20'
const END_OF_MONTH = 'md:w-24'
const METHOD = 'md:w-60'
const CHECKBOX = 'flex min-h-11 items-center gap-2 text-sm md:min-h-9'

const addOpen = ref(false)
const newMethod = ref('MP05')
function added() {
  addOpen.value = false
  newMethod.value = 'MP05'
}

// Deleting asks first (docs/ui.md "Actions")
const deleting = ref<Terms | null>(null)
const deleteOpen = ref(false)
function askDelete(terms: Terms) {
  deleting.value = terms
  deleteOpen.value = true
}
function deleteTerms() {
  deleteOpen.value = false
  if (deleting.value) router.delete(urlFor('payment_terms.destroy', { id: deleting.value.id }))
}
</script>

<template>
  <AppLayout>
    <SettingsScreen route="payment_terms.index">
      <ScreenSection
        :title="t('ui.paymentTerms.title')"
        :description="t('ui.paymentTerms.description')"
        flush
      >
        <template #actions>
          <Button variant="outline" :class="TOUCH" @click="addOpen = true">
            {{ t('ui.paymentTerms.addTitle') }}
          </Button>
        </template>
        <RowHeads
          :heads="[
            { label: t('ui.paymentTerms.name'), class: NAME },
            { label: t('ui.paymentTerms.days'), class: DAYS },
            { label: t('ui.paymentTerms.endOfMonth'), class: END_OF_MONTH },
            { label: t('ui.paymentTerms.paymentMethod'), class: METHOD },
            { label: t('ui.paymentTerms.customers'), class: '' },
          ]"
        />
        <ul class="m-0 list-none p-0">
          <li v-for="terms in paymentTerms" :key="terms.id" :class="EDIT_ROW">
            <Form
              v-slot="{ processing, errors }"
              route="payment_terms.update"
              :params="{ id: terms.id }"
              :class="EDIT_ROW_FORM"
            >
              <RowField :label="t('ui.paymentTerms.name')" :class="NAME">
                <Input
                  name="name"
                  :default-value="terms.name"
                  :aria-label="t('ui.paymentTerms.nameOf', { name: terms.name })"
                  :aria-invalid="errors.name ? 'true' : undefined"
                  :class="TOUCH"
                />
              </RowField>
              <RowField :label="t('ui.paymentTerms.days')" :class="DAYS">
                <Input
                  name="days"
                  type="number"
                  min="0"
                  max="365"
                  :default-value="terms.days"
                  :aria-label="t('ui.paymentTerms.daysFor', { name: terms.name })"
                  :aria-invalid="errors.days ? 'true' : undefined"
                  :class="TOUCH"
                />
              </RowField>
              <label :class="[CHECKBOX, END_OF_MONTH]">
                <input
                  type="checkbox"
                  name="endOfMonth"
                  value="true"
                  :checked="terms.endOfMonth"
                  class="size-4"
                />
                {{ t('ui.paymentTerms.endOfMonth') }}
              </label>
              <RowField :label="t('ui.paymentTerms.paymentMethod')" :class="METHOD">
                <NativeSelect
                  name="paymentMethod"
                  :model-value="terms.paymentMethod"
                  :aria-label="t('ui.paymentTerms.paymentMethodOf', { name: terms.name })"
                  :aria-invalid="errors.paymentMethod ? 'true' : undefined"
                >
                  <option v-for="method in PAYMENT_METHODS" :key="method" :value="method">
                    {{ t(`ui.paymentMethods.${method}`) }}
                  </option>
                </NativeSelect>
              </RowField>
              <span class="flex items-center text-sm text-muted-foreground md:min-h-9">
                {{ t('ui.paymentTerms.customerCount', { count: terms.customerCount }) }}
              </span>
              <Button type="submit" variant="outline" :class="TOUCH" :disabled="processing">
                {{ t('ui.common.save') }}
              </Button>
              <RowErrors
                :errors="errors"
                :fields="{
                  name: t('ui.paymentTerms.name'),
                  days: t('ui.paymentTerms.days'),
                  paymentMethod: t('ui.paymentTerms.paymentMethod'),
                }"
              />
            </Form>
            <Button
              v-if="terms.customerCount === 0"
              type="button"
              variant="ghost"
              :class="TOUCH"
              @click="askDelete(terms)"
            >
              {{ t('ui.common.delete') }}
            </Button>
          </li>
        </ul>
      </ScreenSection>
    </SettingsScreen>

    <Dialog v-model:open="addOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.paymentTerms.addTitle') }}</DialogTitle>
        <DialogDescription>{{ t('ui.paymentTerms.addDescription') }}</DialogDescription>
        <Form
          v-slot="{ processing, errors }"
          route="payment_terms.store"
          class="flex flex-col gap-4"
          @success="added"
        >
          <FormField
            id="new-name"
            v-slot="field"
            :label="t('ui.paymentTerms.name')"
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
          <div class="grid grid-cols-2 items-end gap-3">
            <FormField
              id="new-days"
              v-slot="field"
              :label="t('ui.paymentTerms.days')"
              :error="errors.days"
            >
              <Input
                :id="field.id"
                name="days"
                type="number"
                min="0"
                max="365"
                default-value="30"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
            <label :class="CHECKBOX">
              <input type="checkbox" name="endOfMonth" value="true" class="size-4" />
              {{ t('ui.paymentTerms.endOfMonth') }}
            </label>
          </div>
          <FormField
            id="new-method"
            v-slot="field"
            :label="t('ui.paymentTerms.paymentMethod')"
            :error="errors.paymentMethod"
          >
            <NativeSelect
              :id="field.id"
              v-model="newMethod"
              name="paymentMethod"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            >
              <option v-for="method in PAYMENT_METHODS" :key="method" :value="method">
                {{ t(`ui.paymentMethods.${method}`) }}
              </option>
            </NativeSelect>
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="TOUCH" @click="addOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="TOUCH" :disabled="processing">
              {{ t('ui.paymentTerms.add') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="t('ui.common.delete')"
      :description="t('ui.paymentTerms.deleteConfirm', { name: deleting?.name ?? '' })"
      :confirm-label="t('ui.common.delete')"
      @confirm="deleteTerms"
    />
  </AppLayout>
</template>
