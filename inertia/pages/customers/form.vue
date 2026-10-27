<script setup lang="ts">
import { computed, ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { CUSTOMER_TYPES, customerTypeLabel } from '~/components/customer_types'
import { t } from '~/i18n'

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
  customer:
    | (Record<CustomerField | 'notes', string | null> & {
        id: number
        type: string
        paymentTermsId: number
      })
    | null
  paymentTerms: { id: number; name: string }[]
}>()

const type = ref(props.customer?.type ?? 'private')
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
            type.value === 'condominium' ? t('ui.customers.vatNumberCondominiumHint') : undefined,
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

const sections = computed(() => [
  { key: 'name', title: t('ui.customers.nameSection'), fields: nameFields.value },
  { key: 'tax', title: t('ui.customers.taxSection'), fields: taxFields.value },
  { key: 'billing', title: t('ui.customers.billingSection'), fields: addressFields },
  { key: 'contacts', title: t('ui.customers.contactsSection'), fields: contactFields },
])

const title = props.customer ? t('ui.customers.editTitle') : t('ui.customers.newTitle')
</script>

<template>
  <AppLayout>
    <Page :title="title">
      <Form
        v-slot="{ processing, errors }"
        :route="customer ? 'customers.update' : 'customers.store'"
        :params="customer ? { id: customer.id } : undefined"
      >
        <Section :title="t('ui.customers.typeSection')">
          <div class="field">
            <label class="field__label" for="type">{{ t('ui.customers.typeLabel') }}</label>
            <select id="type" v-model="type" name="type" class="field__input">
              <option v-for="value in CUSTOMER_TYPES" :key="value" :value="value">
                {{ customerTypeLabel(value) }}
              </option>
            </select>
          </div>
        </Section>

        <Section v-for="section in sections" :key="section.key" :title="section.title">
          <div v-for="field in section.fields" :key="field.name" class="field">
            <label class="field__label" :for="field.name">{{ field.label }}</label>
            <input
              :id="field.name"
              :name="field.name"
              :type="field.type ?? 'text'"
              class="field__input"
              :value="customer?.[field.name] ?? ''"
              :aria-invalid="errors[field.name] ? 'true' : 'false'"
            />
            <span v-if="field.hint" class="field__hint">{{ field.hint }}</span>
            <span v-if="errors[field.name]" class="field__error">{{ errors[field.name] }}</span>
          </div>
        </Section>

        <Section :title="t('ui.customers.paymentSection')">
          <div class="field">
            <label class="field__label" for="paymentTermsId">
              {{ t('ui.customers.paymentTerms') }}
            </label>
            <select
              id="paymentTermsId"
              name="paymentTermsId"
              class="field__input"
              :value="customer?.paymentTermsId ?? paymentTerms[0]?.id"
            >
              <option v-for="terms in paymentTerms" :key="terms.id" :value="terms.id">
                {{ terms.name }}
              </option>
            </select>
            <span v-if="errors.paymentTermsId" class="field__error">
              {{ errors.paymentTermsId }}
            </span>
          </div>
          <div class="field">
            <label class="field__label" for="notes">{{ t('ui.customers.notes') }}</label>
            <textarea
              id="notes"
              name="notes"
              class="field__input"
              rows="3"
              :value="customer?.notes ?? ''"
            />
            <span v-if="errors.notes" class="field__error">{{ errors.notes }}</span>
          </div>
        </Section>

        <Section>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.customers.save') }}
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
