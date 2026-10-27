<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Pencil, Plus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SitePicker, { type PickedSite } from '~/components/site_picker.vue'
import { customerTypeLabels } from '~/components/customer_types'
import { urlFor } from '~/client'

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
  }
  sites: { id: number; summary: string }[]
}>()

function linkSite(site: PickedSite) {
  router.post(urlFor('customer_sites.store', { customerId: props.customer.id }), {
    siteId: site.id,
  })
}
</script>

<template>
  <AppLayout>
    <Page :title="customer.displayName" :description="customerTypeLabels[customer.type]">
      <template #actions>
        <Link
          route="customers.edit"
          :params="{ id: customer.id }"
          class="btn btn--secondary btn--sm"
        >
          <Pencil :size="15" /> Edit
        </Link>
      </template>

      <Section title="Details">
        <dl class="details">
          <template v-if="customer.vatNumber">
            <dt>Partita IVA</dt>
            <dd class="mono">{{ customer.vatNumber }}</dd>
          </template>
          <template v-if="customer.taxCode">
            <dt>Codice Fiscale</dt>
            <dd class="mono">{{ customer.taxCode }}</dd>
          </template>
          <dt>SDI code</dt>
          <dd class="mono">{{ customer.sdiCode }}</dd>
          <template v-if="customer.pec">
            <dt>PEC</dt>
            <dd>{{ customer.pec }}</dd>
          </template>
          <dt>Billing address</dt>
          <dd>
            <div v-for="line in customer.billingAddress" :key="line">{{ line }}</div>
          </dd>
          <template v-if="customer.email">
            <dt>Email</dt>
            <dd>{{ customer.email }}</dd>
          </template>
          <template v-if="customer.phone">
            <dt>Phone</dt>
            <dd>{{ customer.phone }}</dd>
          </template>
          <dt>Payment Terms</dt>
          <dd>{{ customer.paymentTerms }}</dd>
          <template v-if="customer.notes">
            <dt>Notes</dt>
            <dd :style="{ whiteSpace: 'pre-line' }">{{ customer.notes }}</dd>
          </template>
        </dl>
      </Section>

      <Section title="Sites" description="Addresses where work is done for this Customer.">
        <table v-if="sites.length" class="table">
          <tbody>
            <tr v-for="site in sites" :key="site.id">
              <td>
                <Link route="sites.edit" :params="{ id: site.id }" class="il">{{
                  site.summary
                }}</Link>
              </td>
              <td class="table__actions">
                <Form
                  route="customer_sites.destroy"
                  :params="{ customerId: customer.id, siteId: site.id }"
                >
                  <button type="submit" class="btn btn--ghost btn--sm">Unlink</button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else :style="{ color: 'var(--subtle)' }">No Sites linked yet.</p>

        <SitePicker
          :customer-id="customer.id"
          label="Link an existing Site"
          :exclude-ids="sites.map((site) => site.id)"
          @select="linkSite"
        />
        <div>
          <Link
            route="sites.create"
            :qs="{ customerId: customer.id }"
            class="btn btn--secondary btn--sm"
          >
            <Plus :size="15" /> New Site for this Customer
          </Link>
        </div>
      </Section>
    </Page>
  </AppLayout>
</template>
