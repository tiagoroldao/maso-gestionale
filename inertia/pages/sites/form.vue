<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'

type SiteField = 'label' | 'street' | 'streetNumber' | 'unit' | 'postalCode' | 'city' | 'province'

const props = defineProps<{
  site: (Record<SiteField | 'accessNotes', string | null> & { id: number }) | null
  customers: { id: number; displayName: string }[]
  forCustomer: { id: number; displayName: string } | null
}>()

const fields: { name: SiteField; label: string; hint?: string }[] = [
  { name: 'label', label: 'Label', hint: 'Optional, e.g. “Casa al mare” or “Negozio”.' },
  { name: 'street', label: 'Street' },
  { name: 'streetNumber', label: 'Street number' },
  { name: 'unit', label: 'Unit', hint: 'Scala, piano, interno…' },
  { name: 'postalCode', label: 'CAP' },
  { name: 'city', label: 'Comune' },
  { name: 'province', label: 'Provincia', hint: 'Two letters, e.g. MI.' },
]

const title = props.site
  ? 'Edit site'
  : props.forCustomer
    ? `New site for ${props.forCustomer.displayName}`
    : 'New site'
</script>

<template>
  <AppLayout>
    <Page :title="title">
      <Form
        v-slot="{ processing, errors }"
        :route="site ? 'sites.update' : 'sites.store'"
        :params="site ? { id: site.id } : undefined"
      >
        <input v-if="forCustomer" type="hidden" name="customerId" :value="forCustomer.id" />

        <Section title="Address">
          <div v-for="field in fields" :key="field.name" class="field">
            <label class="field__label" :for="field.name">{{ field.label }}</label>
            <input
              :id="field.name"
              :name="field.name"
              class="field__input"
              :value="site?.[field.name] ?? ''"
              :aria-invalid="errors[field.name] ? 'true' : 'false'"
            />
            <span v-if="field.hint" class="field__hint">{{ field.hint }}</span>
            <span v-if="errors[field.name]" class="field__error">{{ errors[field.name] }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="accessNotes">Access notes</label>
            <textarea
              id="accessNotes"
              name="accessNotes"
              class="field__input"
              rows="3"
              :value="site?.accessNotes ?? ''"
            />
            <span class="field__hint">Keys, gate codes, parking, who to ask for.</span>
          </div>
        </Section>

        <Section v-if="site" title="Customers">
          <ul v-if="customers.length" :style="{ margin: 0, paddingLeft: '18px' }">
            <li v-for="customer in customers" :key="customer.id">
              <Link route="customers.show" :params="{ id: customer.id }" class="il">
                {{ customer.displayName }}
              </Link>
            </li>
          </ul>
          <p v-else :style="{ color: 'var(--subtle)' }">
            Not linked to any Customer. Link it from a Customer's page.
          </p>
        </Section>

        <Section>
          <button type="submit" class="btn btn--primary" :disabled="processing">Save site</button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
