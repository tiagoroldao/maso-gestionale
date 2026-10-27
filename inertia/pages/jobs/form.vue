<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import CustomerPicker, { type PickedCustomer } from '~/components/customer_picker.vue'
import SitePicker, { type PickedSite } from '~/components/site_picker.vue'
import { t } from '~/i18n'

const WORK_CATEGORIES = ['new_installation', 'maintenance', 'renovation', 'repair', 'sale']

const props = defineProps<{
  job: {
    id: number
    number: string
    kind: string
    status: string
    kindLocked: boolean
    workCategory: string
    title: string
    description: string | null
  } | null
  customer: { id: number; displayName: string } | null
  site: { id: number; summary: string } | null
}>()

const customer = ref<{ id: number; displayName: string } | null>(props.customer)
const site = ref<{ id: number; summary: string } | null>(props.site)

/**
 * Values in reactive state, so picking a Customer or Site (which
 * re-renders the form) keeps what was typed.
 */
const values = reactive({
  kind: props.job?.kind ?? 'quoted',
  workCategory: props.job?.workCategory ?? 'maintenance',
  title: props.job?.title ?? '',
  description: props.job?.description ?? '',
})

function pickCustomer(picked: PickedCustomer) {
  customer.value = picked
  site.value = null
}

function pickSite(picked: PickedSite) {
  site.value = picked
}

const kindLocked = props.job?.kindLocked ?? false
const title = props.job
  ? t('ui.jobs.editTitle', { number: props.job.number })
  : t('ui.jobs.newTitle')
</script>

<template>
  <AppLayout>
    <Page :title="title">
      <Form
        v-slot="{ processing, errors }"
        :route="job ? 'jobs.update' : 'jobs.store'"
        :params="job ? { id: job.id } : undefined"
      >
        <Section :title="t('ui.jobs.customer')">
          <input type="hidden" name="customerId" :value="customer?.id ?? ''" />
          <div v-if="customer" :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
            <strong>{{ customer.displayName }}</strong>
            <button type="button" class="btn btn--ghost btn--sm" @click="customer = null">
              {{ t('ui.jobs.changeCustomer') }}
            </button>
          </div>
          <CustomerPicker v-else @select="pickCustomer" />
          <span v-if="errors.customerId" class="field__error">{{ errors.customerId }}</span>
        </Section>

        <Section :title="t('ui.jobs.site')" :description="t('ui.jobs.siteHint')">
          <input type="hidden" name="siteId" :value="site?.id ?? ''" />
          <div v-if="site" :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
            <span>{{ site.summary }}</span>
            <button type="button" class="btn btn--ghost btn--sm" @click="site = null">
              {{ t('ui.jobs.removeSite') }}
            </button>
          </div>
          <SitePicker
            v-else-if="customer"
            :key="customer.id"
            :customer-id="customer.id"
            @select="pickSite"
          />
          <span v-if="errors.siteId" class="field__error">{{ errors.siteId }}</span>
        </Section>

        <Section :title="t('ui.jobs.detailsSection')">
          <div class="field">
            <label class="field__label" for="kind">{{ t('ui.jobs.kind') }}</label>
            <select
              id="kind"
              v-model="values.kind"
              name="kind"
              class="field__input"
              :disabled="kindLocked"
            >
              <option value="quoted">{{ t('ui.jobs.kinds.quoted') }}</option>
              <option value="time_and_materials">
                {{ t('ui.jobs.kinds.time_and_materials') }}
              </option>
            </select>
            <input v-if="kindLocked" type="hidden" name="kind" :value="values.kind" />
            <span class="field__hint">
              {{ kindLocked ? t('ui.jobs.kindLocked') : t('ui.jobs.kindHint') }}
            </span>
          </div>
          <div class="field">
            <label class="field__label" for="workCategory">{{ t('ui.jobs.workCategory') }}</label>
            <select
              id="workCategory"
              v-model="values.workCategory"
              name="workCategory"
              class="field__input"
            >
              <option v-for="category in WORK_CATEGORIES" :key="category" :value="category">
                {{ t(`ui.jobs.workCategories.${category}`) }}
              </option>
            </select>
            <span class="field__hint">{{ t('ui.jobs.workCategoryHint') }}</span>
            <span v-if="errors.workCategory" class="field__error">{{ errors.workCategory }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="title">{{ t('ui.jobs.jobTitle') }}</label>
            <input id="title" v-model="values.title" name="title" class="field__input" />
            <span v-if="errors.title" class="field__error">{{ errors.title }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="description">{{ t('ui.jobs.description') }}</label>
            <textarea
              id="description"
              v-model="values.description"
              name="description"
              class="field__input"
              rows="4"
            />
          </div>
        </Section>

        <Section>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ job ? t('ui.jobs.save') : t('ui.jobs.create') }}
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
