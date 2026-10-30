<script setup lang="ts">
/**
 * A Customer in edit mode (docs/ui.md "Kinds of screen"): the Customer
 * screen wrapped in its form, Save its primary action. The fields follow
 * the type: a private individual's name, or a company's, a condominium's
 * or an organisation's.
 */
import { computed, reactive, ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { CUSTOMER_TYPES, customerTypeLabel } from '~/components/customer_types'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import type { ScreenAction } from '@shared/screen_actions'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import { Textarea } from '~/components/ui/textarea'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import FormField from '~/components/screen/form_field.vue'
import type { Crumb } from '~/components/screen/screen'

type CustomerField =
  | 'firstName'
  | 'lastName'
  | 'name'
  | 'vatNumber'
  | 'taxCode'
  | 'sdiCode'
  | 'pec'
  | 'street'
  | 'streetNumber'
  | 'postalCode'
  | 'city'
  | 'province'
  | 'email'
  | 'phone'

const props = defineProps<{
  // Save, the screen's primary
  actions: ScreenAction[]
  customer:
    | (Record<CustomerField | 'notes', string | null> & {
        id: number
        displayName: string
        type: string
        paymentTermsId: number
      })
    | null
  paymentTerms: { id: number; name: string }[]
}>()

const type = ref(props.customer?.type ?? 'private')

/**
 * Field values live in reactive state (not one-way :value bindings), so
 * switching the type re-renders the form without wiping what was typed.
 */
const values = reactive<Record<CustomerField | 'notes', string>>({
  firstName: props.customer?.firstName ?? '',
  lastName: props.customer?.lastName ?? '',
  name: props.customer?.name ?? '',
  vatNumber: props.customer?.vatNumber ?? '',
  taxCode: props.customer?.taxCode ?? '',
  sdiCode: props.customer?.sdiCode ?? '',
  pec: props.customer?.pec ?? '',
  street: props.customer?.street ?? '',
  streetNumber: props.customer?.streetNumber ?? '',
  postalCode: props.customer?.postalCode ?? '',
  city: props.customer?.city ?? '',
  province: props.customer?.province ?? '',
  email: props.customer?.email ?? '',
  phone: props.customer?.phone ?? '',
  notes: props.customer?.notes ?? '',
})
const paymentTermsId = ref(String(props.customer?.paymentTermsId ?? props.paymentTerms[0]?.id))
const isPrivate = computed(() => type.value === 'private')

type Field = { name: CustomerField; label: string; hint?: string; type?: string }

const nameFields = computed<Field[]>(() =>
  isPrivate.value
    ? [
        { name: 'firstName', label: t('ui.customers.firstName') },
        { name: 'lastName', label: t('ui.customers.lastName') },
      ]
    : [
        {
          name: 'name',
          label:
            type.value === 'condominium'
              ? t('ui.customers.condominiumName')
              : type.value === 'organisation'
                ? t('ui.customers.organisationName')
                : t('ui.customers.companyName'),
        },
      ]
)

const taxFields = computed<Field[]>(() => [
  ...(isPrivate.value
    ? []
    : [
        {
          name: 'vatNumber' as const,
          label: t('ui.customers.vatNumber'),
          hint:
            type.value === 'condominium'
              ? t('ui.customers.vatNumberCondominiumHint')
              : type.value === 'organisation'
                ? t('ui.customers.vatNumberOrganisationHint')
                : undefined,
        },
      ]),
  {
    name: 'taxCode',
    label: t('ui.customers.taxCode'),
    hint: type.value === 'company' ? t('ui.customers.taxCodeCompanyHint') : undefined,
  },
  { name: 'sdiCode', label: t('ui.customers.sdiCode'), hint: t('ui.customers.sdiCodeHint') },
  { name: 'pec', label: t('ui.customers.pec'), type: 'email' },
])

const addressFields: Field[] = [
  { name: 'street', label: t('ui.address.street') },
  { name: 'streetNumber', label: t('ui.address.streetNumber') },
  { name: 'postalCode', label: t('ui.address.postalCode') },
  { name: 'city', label: t('ui.address.city') },
  { name: 'province', label: t('ui.address.province'), hint: t('ui.address.provinceHint') },
]

const contactFields: Field[] = [
  { name: 'email', label: t('ui.customers.email'), type: 'email' },
  { name: 'phone', label: t('ui.customers.phone'), type: 'tel' },
]

const main = computed(() => [
  { key: 'tax', title: t('ui.customers.taxSection'), fields: taxFields.value },
  { key: 'billing', title: t('ui.customers.billingSection'), fields: addressFields },
])

// Where the screen sits: under the Customer when editing it, under Clienti when new
const list: Crumb = { label: t('ui.customers.title'), href: urlFor('customers.index') }
const crumbs = props.customer
  ? [
      list,
      {
        label: props.customer.displayName,
        href: urlFor('customers.show', { id: props.customer.id }),
      },
    ]
  : [list]
const title = props.customer?.displayName ?? t('ui.customers.newTitle')
const current = props.customer ? t('ui.common.edit') : t('ui.customers.newTitle')
const documentTitle = props.customer ? t('ui.customers.editTitle') : t('ui.customers.newTitle')

const GRID = 'grid gap-4 md:grid-cols-2'
const INPUT = 'h-11 md:h-9'
</script>

<template>
  <AppLayout>
    <Form
      v-slot="{ processing, errors }"
      :route="customer ? 'customers.update' : 'customers.store'"
      :params="customer ? { id: customer.id } : undefined"
      class="w-full min-w-0"
    >
      <EntityScreen
        :document-title="documentTitle"
        :crumbs="crumbs"
        :current="current"
        :title="title"
        :actions="actions"
        :busy="processing"
      >
        <template #main>
          <ScreenSection :title="t('ui.customers.identitySection')">
            <div :class="GRID">
              <FormField id="type" v-slot="field" :label="t('ui.customers.typeLabel')">
                <NativeSelect :id="field.id" v-model="type" name="type">
                  <option v-for="value in CUSTOMER_TYPES" :key="value" :value="value">
                    {{ customerTypeLabel(value) }}
                  </option>
                </NativeSelect>
              </FormField>
              <FormField
                v-for="input in nameFields"
                :id="input.name"
                :key="input.name"
                v-slot="field"
                :label="input.label"
                :hint="input.hint"
                :error="errors[input.name]"
              >
                <Input
                  :id="field.id"
                  v-model="values[input.name]"
                  :name="input.name"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </div>
          </ScreenSection>

          <ScreenSection v-for="section in main" :key="section.key" :title="section.title">
            <div :class="GRID">
              <FormField
                v-for="input in section.fields"
                :id="input.name"
                :key="input.name"
                v-slot="field"
                :label="input.label"
                :hint="input.hint"
                :error="errors[input.name]"
              >
                <Input
                  :id="field.id"
                  v-model="values[input.name]"
                  :name="input.name"
                  :type="input.type ?? 'text'"
                  :class="INPUT"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                />
              </FormField>
            </div>
          </ScreenSection>
        </template>

        <template #side>
          <ScreenSection :title="t('ui.customers.contactsSection')">
            <FormField
              v-for="input in contactFields"
              :id="input.name"
              :key="input.name"
              v-slot="field"
              :label="input.label"
              :error="errors[input.name]"
            >
              <Input
                :id="field.id"
                v-model="values[input.name]"
                :name="input.name"
                :type="input.type"
                :class="INPUT"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </ScreenSection>

          <ScreenSection :title="t('ui.customers.paymentSection')">
            <FormField
              id="paymentTermsId"
              v-slot="field"
              :label="t('ui.customers.paymentTerms')"
              :error="errors.paymentTermsId"
            >
              <NativeSelect
                :id="field.id"
                v-model="paymentTermsId"
                name="paymentTermsId"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              >
                <option v-for="terms in paymentTerms" :key="terms.id" :value="String(terms.id)">
                  {{ terms.name }}
                </option>
              </NativeSelect>
            </FormField>
            <FormField
              id="notes"
              v-slot="field"
              :label="t('ui.customers.notes')"
              :error="errors.notes"
            >
              <Textarea
                :id="field.id"
                v-model="values.notes"
                name="notes"
                rows="3"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </ScreenSection>
        </template>
      </EntityScreen>
    </Form>
  </AppLayout>
</template>
