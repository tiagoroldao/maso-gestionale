<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Pencil, Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SitePicker, { type PickedSite } from '~/components/site_picker.vue'
import { customerTypeLabel } from '~/components/customer_types'
import { urlFor } from '~/client'
import JobList, { type JobRow } from '~/components/job_list.vue'
import { t } from '~/i18n'

const props = defineProps<{
  customer: {
    id: number
    displayName: string
    type: string
    vatNumber: string | null
    taxCode: string | null
    sdiCode: string
    pec: string | null
    billingAddress: string[]
    email: string | null
    phone: string | null
    notes: string | null
    paymentTerms: string
    archived: boolean
  }
  sites: { id: number; summary: string }[]
  jobs: JobRow[]
}>()

const confirm = (message: string) => window.confirm(message)

function linkSite(site: PickedSite) {
  router.post(urlFor('customer_sites.store', { customerId: props.customer.id }), {
    siteId: site.id,
  })
}
</script>

<template>
  <AppLayout>
    <Page :title="customer.displayName" :description="customerTypeLabel(customer.type)">
      <template #actions>
        <Link
          route="customers.edit"
          :params="{ id: customer.id }"
          class="btn btn--secondary btn--sm"
        >
          <Pencil :size="15" /> {{ t('ui.common.edit') }}
        </Link>
        <Form
          :route="customer.archived ? 'customers.restore' : 'customers.archive'"
          :params="{ id: customer.id }"
          :on-before="() => customer.archived || confirm(t('ui.archive.confirm'))"
        >
          <button type="submit" class="btn btn--ghost btn--sm">
            {{ customer.archived ? t('ui.archive.restore') : t('ui.archive.archive') }}
          </button>
        </Form>
      </template>

      <p v-if="customer.archived" class="tag">{{ t('ui.archive.archivedTag') }}</p>

      <Section :title="t('ui.customers.details')">
        <dl class="details">
          <template v-if="customer.vatNumber">
            <dt>{{ t('ui.customers.vatNumber') }}</dt>
            <dd class="mono">{{ customer.vatNumber }}</dd>
          </template>
          <template v-if="customer.taxCode">
            <dt>{{ t('ui.customers.taxCode') }}</dt>
            <dd class="mono">{{ customer.taxCode }}</dd>
          </template>
          <dt>{{ t('ui.customers.sdiCode') }}</dt>
          <dd class="mono">{{ customer.sdiCode }}</dd>
          <template v-if="customer.pec">
            <dt>{{ t('ui.customers.pec') }}</dt>
            <dd>{{ customer.pec }}</dd>
          </template>
          <dt>{{ t('ui.customers.billingAddress') }}</dt>
          <dd>
            <div v-for="line in customer.billingAddress" :key="line">{{ line }}</div>
          </dd>
          <template v-if="customer.email">
            <dt>{{ t('ui.customers.email') }}</dt>
            <dd>{{ customer.email }}</dd>
          </template>
          <template v-if="customer.phone">
            <dt>{{ t('ui.customers.phone') }}</dt>
            <dd>{{ customer.phone }}</dd>
          </template>
          <dt>{{ t('ui.customers.paymentTerms') }}</dt>
          <dd>{{ customer.paymentTerms }}</dd>
          <template v-if="customer.notes">
            <dt>{{ t('ui.customers.notes') }}</dt>
            <dd :style="{ whiteSpace: 'pre-line' }">{{ customer.notes }}</dd>
          </template>
        </dl>
      </Section>

      <Section
        :title="t('ui.customers.sitesTitle')"
        :description="t('ui.customers.sitesDescription')"
      >
        <table v-if="sites.length" class="table">
          <tbody>
            <tr v-for="site in sites" :key="site.id">
              <td>
                <Link route="sites.show" :params="{ id: site.id }" class="il">
                  {{ site.summary }}
                </Link>
              </td>
              <td class="table__actions">
                <Form
                  route="customer_sites.destroy"
                  :params="{ customerId: customer.id, siteId: site.id }"
                >
                  <button type="submit" class="btn btn--ghost btn--sm">
                    {{ t('ui.customers.unlink') }}
                  </button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.customers.noSites') }}</p>

        <SitePicker
          :customer-id="customer.id"
          :label="t('ui.customers.linkSite')"
          :exclude-ids="sites.map((site) => site.id)"
          @select="linkSite"
        />
        <div>
          <Link
            route="sites.create"
            :qs="{ customerId: customer.id }"
            class="btn btn--secondary btn--sm"
          >
            <Plus :size="15" /> {{ t('ui.customers.newSite') }}
          </Link>
        </div>
      </Section>
      <Section :title="t('ui.jobs.title')">
        <JobList v-if="jobs.length" :jobs="jobs" :show-customer="false" />
        <p v-else :style="{ color: 'var(--subtle)' }">{{ t('ui.jobs.empty') }}</p>
        <div>
          <Link
            route="jobs.create"
            :qs="{ customerId: customer.id }"
            class="btn btn--secondary btn--sm"
          >
            <Plus :size="15" /> {{ t('ui.jobs.newForCustomer') }}
          </Link>
        </div>
      </Section>
    </Page>
  </AppLayout>
</template>
