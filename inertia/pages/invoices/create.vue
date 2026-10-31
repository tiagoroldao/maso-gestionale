<script setup lang="ts">
/**
 * A new Invoice without a Job (a direct sale), an Entity screen in edit
 * mode (docs/ui.md "Kinds of screen"): the screen wrapped in its form,
 * creating the draft its Save, under Fatture. Only the Customer is asked
 * for; the lines follow on the draft.
 */
import { computed, ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import CustomerPicker, { type PickedCustomer } from '~/components/customer_picker.vue'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import { TOUCH } from '~/components/screen/screen'
import { Button } from '~/components/ui/button'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import type { ScreenAction } from '@shared/screen_actions'

const props = defineProps<{
  // Save (creating the draft), the screen's primary
  actions: ScreenAction[]
}>()

const customer = ref<PickedCustomer | null>(null)
// Nothing to create until a Customer is picked
const screenActions = computed(() =>
  props.actions.map((action) =>
    customer.value ? action : { ...action, disabledReason: t('ui.invoices.pickCustomer') }
  )
)
</script>

<template>
  <AppLayout>
    <Form v-slot="{ processing, errors }" route="invoices.store" class="w-full min-w-0">
      <EntityScreen
        :document-title="t('ui.invoices.newTitle')"
        :crumbs="[{ label: t('ui.invoices.title'), href: urlFor('invoices.index') }]"
        :current="t('ui.invoices.newTitle')"
        :title="t('ui.invoices.newTitle')"
        :facts="t('ui.invoices.newDescription')"
        :actions="screenActions"
        :busy="processing"
      >
        <template #main>
          <ScreenSection :title="t('ui.invoices.customer')">
            <input type="hidden" name="customerId" :value="customer?.id ?? ''" />
            <div v-if="customer" class="flex flex-wrap items-center gap-2 text-sm">
              <strong>{{ customer.displayName }}</strong>
              <span v-if="customer.city" class="text-muted-foreground">{{ customer.city }}</span>
              <Button type="button" variant="outline" :class="TOUCH" @click="customer = null">
                {{ t('ui.invoices.changeCustomer') }}
              </Button>
            </div>
            <CustomerPicker v-else @select="(picked) => (customer = picked)" />
            <p
              v-if="errors.customerId"
              class="m-0 flex items-start gap-1.5 text-sm text-destructive"
            >
              <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
              {{ errors.customerId }}
            </p>
          </ScreenSection>
        </template>
      </EntityScreen>
    </Form>
  </AppLayout>
</template>
