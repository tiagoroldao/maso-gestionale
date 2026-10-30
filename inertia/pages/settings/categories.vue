<script setup lang="ts">
/**
 * Categorie, a settings screen on the new UI (docs/ui.md "Settings"): the
 * Categories edited in place, new ones added from the section's dialog,
 * and those with no Items deleted, after confirming.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Form } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
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
import { EDIT_ROW, EDIT_ROW_FORM, TOUCH } from '~/components/screen/screen'

type Category = { id: number; name: string; markupPercent: string; itemCount: number }

defineProps<{ categories: Category[] }>()

const percent = (value: string) => amountForInput(value).replace(/,00$/, '')

const NAME = 'md:w-56'
const MARKUP = 'md:w-28'

const addOpen = ref(false)

// Deleting asks first (docs/ui.md "Actions")
const deleting = ref<Category | null>(null)
const deleteOpen = ref(false)
function askDelete(category: Category) {
  deleting.value = category
  deleteOpen.value = true
}
function deleteCategory() {
  deleteOpen.value = false
  if (deleting.value) router.delete(urlFor('categories.destroy', { id: deleting.value.id }))
}
</script>

<template>
  <AppLayout>
    <SettingsScreen route="categories.index">
      <ScreenSection
        :title="t('ui.categories.title')"
        :description="t('ui.categories.description')"
        flush
      >
        <template #actions>
          <Button variant="outline" :class="TOUCH" @click="addOpen = true">
            {{ t('ui.categories.addTitle') }}
          </Button>
        </template>
        <RowHeads
          v-if="categories.length"
          :heads="[
            { label: t('ui.categories.name'), class: NAME },
            { label: t('ui.categories.markup'), class: MARKUP },
            { label: t('ui.categories.items'), class: '' },
          ]"
        />
        <ul class="m-0 list-none p-0">
          <li v-for="category in categories" :key="category.id" :class="EDIT_ROW">
            <Form
              v-slot="{ processing, errors }"
              route="categories.update"
              :params="{ id: category.id }"
              :class="EDIT_ROW_FORM"
            >
              <RowField :label="t('ui.categories.name')" :class="NAME">
                <Input
                  name="name"
                  :default-value="category.name"
                  :aria-label="t('ui.categories.nameOf', { name: category.name })"
                  :aria-invalid="errors.name ? 'true' : undefined"
                  :class="TOUCH"
                />
              </RowField>
              <RowField :label="t('ui.categories.markup')" :class="MARKUP">
                <Input
                  name="markupPercent"
                  inputmode="decimal"
                  :default-value="percent(category.markupPercent)"
                  :aria-label="t('ui.categories.markupFor', { name: category.name })"
                  :aria-invalid="errors.markupPercent ? 'true' : undefined"
                  :class="TOUCH"
                />
              </RowField>
              <span class="flex items-center text-sm text-muted-foreground md:min-h-9">
                {{ t('ui.categories.itemCount', { count: category.itemCount }) }}
              </span>
              <Button type="submit" variant="outline" :class="TOUCH" :disabled="processing">
                {{ t('ui.common.save') }}
              </Button>
              <RowErrors
                :errors="errors"
                :fields="{
                  name: t('ui.categories.name'),
                  markupPercent: t('ui.categories.markup'),
                }"
              />
            </Form>
            <Button
              v-if="category.itemCount === 0"
              type="button"
              variant="ghost"
              :class="TOUCH"
              @click="askDelete(category)"
            >
              {{ t('ui.common.delete') }}
            </Button>
          </li>
        </ul>
      </ScreenSection>
    </SettingsScreen>

    <Dialog v-model:open="addOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')" :aria-describedby="undefined">
        <DialogTitle>{{ t('ui.categories.addTitle') }}</DialogTitle>
        <Form
          v-slot="{ processing, errors }"
          route="categories.store"
          class="flex flex-col gap-4"
          @success="addOpen = false"
        >
          <FormField
            id="new-category-name"
            v-slot="field"
            :label="t('ui.categories.name')"
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
            id="new-category-markup"
            v-slot="field"
            :label="t('ui.categories.markup')"
            :error="errors.markupPercent"
          >
            <Input
              :id="field.id"
              name="markupPercent"
              inputmode="decimal"
              default-value="30"
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
              {{ t('ui.categories.add') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="t('ui.common.delete')"
      :description="t('ui.categories.deleteConfirm', { name: deleting?.name ?? '' })"
      :confirm-label="t('ui.common.delete')"
      @confirm="deleteCategory"
    />
  </AppLayout>
</template>
