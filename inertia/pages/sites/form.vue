<script setup lang="ts">
/**
 * A Site in edit mode (docs/ui.md "Kinds of screen"): the Site screen
 * wrapped in its form, Save its primary action. A new Site for a Customer
 * sits under that Customer, and is linked to it on saving.
 */
import { Form, Link } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import type { ScreenAction } from '@shared/screen_actions'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import FormField from '~/components/screen/form_field.vue'
import { LINK, ROW, type Crumb } from '~/components/screen/screen'

type SiteField = 'label' | 'street' | 'streetNumber' | 'unit' | 'postalCode' | 'city' | 'province'

const props = defineProps<{
  // Save, the screen's primary
  actions: ScreenAction[]
  site:
    | (Record<SiteField | 'accessNotes', string | null> & {
        id: number
        summary: string
        residential: boolean
      })
    | null
  customers: { id: number; displayName: string }[]
  forCustomer: { id: number; displayName: string } | null
}>()

const fields: { name: SiteField; label: string; hint?: string }[] = [
  { name: 'label', label: t('ui.sites.label'), hint: t('ui.sites.labelHint') },
  { name: 'street', label: t('ui.address.street') },
  { name: 'streetNumber', label: t('ui.address.streetNumber') },
  { name: 'unit', label: t('ui.sites.unit') },
  { name: 'postalCode', label: t('ui.address.postalCode') },
  { name: 'city', label: t('ui.address.city') },
  { name: 'province', label: t('ui.address.province'), hint: t('ui.address.provinceHint') },
]

// Where the screen sits: under the Site when editing it, under its Customer or Immobili when new
const list: Crumb = { label: t('ui.sites.title'), href: urlFor('sites.index') }
const crumbs: Crumb[] = props.site
  ? [list, { label: props.site.summary, href: urlFor('sites.show', { id: props.site.id }) }]
  : props.forCustomer
    ? [
        { label: t('ui.customers.title'), href: urlFor('customers.index') },
        {
          label: props.forCustomer.displayName,
          href: urlFor('customers.show', { id: props.forCustomer.id }),
        },
      ]
    : [list]
const title = props.site
  ? props.site.summary
  : props.forCustomer
    ? t('ui.sites.newForCustomer', { name: props.forCustomer.displayName })
    : t('ui.sites.newTitle')
const current = props.site ? t('ui.common.edit') : t('ui.sites.newTitle')
const documentTitle = props.site ? t('ui.sites.editTitle') : title

const INPUT = 'h-11 md:h-9'
</script>

<template>
  <AppLayout>
    <Form
      v-slot="{ processing, errors }"
      :route="site ? 'sites.update' : 'sites.store'"
      :params="site ? { id: site.id } : undefined"
      class="w-full min-w-0"
    >
      <input v-if="forCustomer" type="hidden" name="customerId" :value="forCustomer.id" />
      <EntityScreen
        :document-title="documentTitle"
        :crumbs="crumbs"
        :current="current"
        :title="title"
        :actions="actions"
        :busy="processing"
      >
        <template #main>
          <ScreenSection :title="t('ui.sites.site')">
            <div class="grid gap-4 md:grid-cols-2">
              <FormField
                v-for="input in fields"
                :id="input.name"
                :key="input.name"
                v-slot="field"
                :label="input.label"
                :hint="input.hint"
                :error="errors[input.name]"
              >
                <Input
                  :id="field.id"
                  :name="input.name"
                  :default-value="site?.[input.name] ?? ''"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="flex min-h-11 items-center gap-2.5 text-sm font-medium md:min-h-0">
                <input
                  type="checkbox"
                  name="residential"
                  value="true"
                  :checked="site?.residential ?? true"
                  class="size-4"
                  aria-describedby="residential-hint"
                />
                {{ t('ui.sites.residential') }}
              </label>
              <p id="residential-hint" class="m-0 text-[13px] text-muted-foreground">
                {{ t('ui.sites.residentialHint') }}
              </p>
            </div>
            <FormField
              id="accessNotes"
              v-slot="field"
              :label="t('ui.sites.accessNotes')"
              :hint="t('ui.sites.accessNotesHint')"
              :error="errors.accessNotes"
            >
              <Textarea
                :id="field.id"
                name="accessNotes"
                rows="3"
                :default-value="site?.accessNotes ?? ''"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </ScreenSection>
        </template>

        <template v-if="site" #side>
          <ScreenSection :title="t('ui.sites.customers')" flush>
            <ul v-if="customers.length" class="m-0 list-none p-0">
              <li v-for="customer in customers" :key="customer.id" :class="ROW">
                <Link
                  route="customers.show"
                  :params="{ id: customer.id }"
                  :class="cn(LINK, 'text-sm')"
                >
                  {{ customer.displayName }}
                </Link>
              </li>
            </ul>
            <p
              v-else
              class="m-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4"
            >
              {{ t('ui.sites.notLinkedHint') }}
            </p>
          </ScreenSection>
        </template>
      </EntityScreen>
    </Form>
  </AppLayout>
</template>
