<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { t } from '~/i18n'

type SiteField = 'label' | 'street' | 'streetNumber' | 'unit' | 'postalCode' | 'city' | 'province'

const props = defineProps<{
  site: (Record<SiteField | 'accessNotes', string | null> & { id: number }) | null
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

const title = props.site
  ? t('ui.sites.editTitle')
  : props.forCustomer
    ? t('ui.sites.newForCustomer', { name: props.forCustomer.displayName })
    : t('ui.sites.newTitle')
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

        <Section :title="t('ui.sites.addressSection')">
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
            <label class="field__label" for="accessNotes">{{ t('ui.sites.accessNotes') }}</label>
            <textarea
              id="accessNotes"
              name="accessNotes"
              class="field__input"
              rows="3"
              :value="site?.accessNotes ?? ''"
            />
            <span class="field__hint">{{ t('ui.sites.accessNotesHint') }}</span>
          </div>
        </Section>

        <Section v-if="site" :title="t('ui.sites.customers')">
          <ul v-if="customers.length" :style="{ margin: 0, paddingLeft: '18px' }">
            <li v-for="customer in customers" :key="customer.id">
              <Link route="customers.show" :params="{ id: customer.id }" class="il">
                {{ customer.displayName }}
              </Link>
            </li>
          </ul>
          <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.sites.notLinkedHint') }}</p>
        </Section>

        <Section>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.sites.save') }}
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
