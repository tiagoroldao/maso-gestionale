<script setup lang="ts">
import { computed, ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { customerTypeLabels } from '~/components/customer_types'

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
        { name: 'firstName', label: 'First name' },
        { name: 'lastName', label: 'Last name' },
      ]
    : [{ name: 'name', label: type.value === 'condominium' ? 'Condominium name' : 'Company name' }]
)

const taxFields = computed<Field[]>(() => [
  ...(isPrivate.value
    ? []
    : [
        {
          name: 'vatNumber' as const,
          label: 'Partita IVA',
          hint: type.value === 'condominium' ? 'Usually empty for condominiums.' : undefined,
        },
      ]),
  {
    name: 'taxCode',
    label: 'Codice Fiscale',
    hint: type.value === 'company' ? 'Optional when it is the same as the Partita IVA.' : undefined,
  },
  {
    name: 'sdiCode',
    label: 'SDI code (codice destinatario)',
    hint: 'Seven characters. Leave empty for 0000000.',
  },
  { name: 'pec', label: 'PEC', type: 'email' },
])

const addressFields: Field[] = [
  { name: 'street', label: 'Street' },
  { name: 'streetNumber', label: 'Street number' },
  { name: 'postalCode', label: 'CAP' },
  { name: 'city', label: 'Comune' },
  { name: 'province', label: 'Provincia', hint: 'Two letters, e.g. MI.' },
]

const contactFields: Field[] = [
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel' },
]

const sections = computed(() => [
  { title: 'Name', fields: nameFields.value },
  { title: 'Tax and electronic invoicing', fields: taxFields.value },
  { title: 'Billing address', fields: addressFields },
  { title: 'Contacts', fields: contactFields },
])

const title = props.customer ? 'Edit customer' : 'New customer'
</script>

<template>
  <AppLayout>
    <Page :title="title">
      <Form
        v-slot="{ processing, errors }"
        :route="customer ? 'customers.update' : 'customers.store'"
        :params="customer ? { id: customer.id } : undefined"
      >
        <Section title="Type">
          <div class="field">
            <label class="field__label" for="type">Customer type</label>
            <select id="type" v-model="type" name="type" class="field__input">
              <option v-for="(label, value) in customerTypeLabels" :key="value" :value="value">
                {{ label }}
              </option>
            </select>
          </div>
        </Section>

        <Section v-for="section in sections" :key="section.title" :title="section.title">
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

        <Section title="Payment and notes">
          <div class="field">
            <label class="field__label" for="paymentTermsId">Payment Terms</label>
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
            <label class="field__label" for="notes">Notes</label>
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
            Save customer
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
