<script setup lang="ts">
/**
 * Issuing a document, an Entity screen in edit mode under the Customer it
 * is for (docs/ui.md "Kinds of screen"): first the template to issue,
 * then its fields, filled for the Customer. The header's "Emetti
 * documento" sends them; the document is frozen once issued, so a
 * mistake is put right by a replacement, which this screen also issues,
 * under the document it replaces.
 */
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { ChevronRight, CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import TemplateDataForm from '~/components/template_data_form.vue'
import type { PickedCustomer } from '~/components/customer_picker.vue'
import { postJson, urlFor } from '~/client'
import { t } from '~/i18n'
import type { TemplateField, TemplatePrefill } from '@shared/document_templates'
import type { ScreenAction } from '@shared/screen_actions'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import { EMPTY, LINK, ROW } from '~/components/screen/screen'

const props = defineProps<{
  // "Emetti documento" once the template is chosen; none before
  actions: ScreenAction[]
  templates: { id: number; name: string }[]
  template: { id: number; name: string; fields: TemplateField[] } | null
  customer: PickedCustomer | null
  replaces: { id: number; number: string; title: string } | null
  prefill: Record<string, TemplatePrefill>
}>()

const title = computed(() =>
  props.replaces
    ? t('ui.issuedDocuments.replaceTitle', { number: props.replaces.number })
    : t('ui.issuedDocuments.newTitle')
)

// Under the Customer it is for, or the document it replaces
const crumbs = computed(() => {
  const steps = [{ label: t('ui.customers.title'), href: urlFor('customers.index') }]
  if (props.customer) {
    steps.push({
      label: props.customer.displayName,
      href: urlFor('customers.show', { id: props.customer.id }),
    })
  }
  if (props.replaces) {
    steps.push({
      label: t('ui.issuedDocuments.showTitle', {
        name: props.replaces.title,
        number: props.replaces.number,
      }),
      href: urlFor('issued_documents.show', { id: props.replaces.id }),
    })
  }
  return steps
})

const form = ref<InstanceType<typeof TemplateDataForm> | null>(null)
const errors = ref<Record<string, string>>({})
const failed = ref(false)

/**
 * "Emetti documento" asks first (docs/ui.md "Actions"), naming the
 * Customer chosen in the form, which the server can't see; with none
 * chosen yet it waits for one, its reason beside it.
 */
const screenActions = computed(() =>
  props.actions.map((action) => {
    if (action.name !== 'save' || !props.template) return action
    const customer = form.value?.customer
    if (!customer) return { ...action, disabledReason: t('ui.issuedDocuments.chooseCustomer') }
    return {
      ...action,
      confirm: t('ui.issuedDocuments.issueConfirm', {
        template: props.template.name,
        customer: customer.displayName,
      }),
    }
  })
)
const issuing = ref(false)

async function issue() {
  if (!form.value || !props.template || issuing.value) return
  issuing.value = true
  failed.value = false
  try {
    const url = props.replaces
      ? urlFor('issued_documents.store_replacement', { id: props.replaces.id })
      : urlFor('issued_documents.store')
    const answer = await postJson<{ id: number } | { errors: Record<string, string> }>(url, {
      templateId: props.template.id,
      ...form.value.input(),
    })
    if (answer?.status === 200 && 'id' in answer.data) {
      // Issued: the button stays held while its page loads, so a second
      // click or Enter can't issue another numbered document
      router.visit(urlFor('issued_documents.show', { id: answer.data.id }))
      return
    }
    errors.value = answer && 'errors' in answer.data ? answer.data.errors : {}
    failed.value = true
    issuing.value = false
  } catch {
    failed.value = true
    issuing.value = false
  }
}

/**
 * Enter in a picker's search field picks nothing and issues nothing: only
 * Enter in a value's own field submits the form
 */
function holdSearchEnter(event: KeyboardEvent) {
  if ((event.target as HTMLInputElement).type === 'search') event.preventDefault()
}

const ERROR =
  'm-0 flex items-start gap-1.5 rounded-sm border border-destructive bg-card px-3.5 py-3 text-sm text-destructive md:px-4'
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="title"
      :crumbs="crumbs"
      :current="replaces ? t('ui.issuedDocuments.replacement') : title"
      :title="title"
      :actions="screenActions"
      :busy="issuing"
    >
      <ScreenSection v-if="!template" :title="t('ui.issuedDocuments.chooseTemplate')" flush>
        <p v-if="templates.length === 0" :class="EMPTY">
          {{ t('ui.issuedDocuments.noTemplates') }}
        </p>
        <ul v-else class="m-0 list-none p-0">
          <li v-for="one in templates" :key="one.id" :class="[ROW, 'items-center']">
            <Link
              route="issued_documents.create"
              :qs="
                customer ? { templateId: one.id, customerId: customer.id } : { templateId: one.id }
              "
              :class="[LINK, 'flex min-h-8 flex-1 items-center justify-between gap-2']"
            >
              {{ one.name }}
              <ChevronRight :size="16" aria-hidden="true" class="text-muted-foreground" />
            </Link>
          </li>
        </ul>
      </ScreenSection>

      <!-- issue() sends it as JSON: the form lets the header's button, and Enter, submit it -->
      <form
        v-else
        id="issued-document"
        class="flex flex-col gap-3 md:gap-5"
        novalidate
        @keydown.enter="holdSearchEnter"
        @submit.prevent="issue"
      >
        <p v-if="errors.templateId || failed" role="alert" :class="ERROR">
          <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
          {{ errors.templateId ?? t('ui.issuedDocuments.failed') }}
        </p>
        <ScreenSection :title="template.name">
          <div class="md:max-w-3xl">
            <TemplateDataForm
              ref="form"
              :fields="template.fields"
              :errors="errors"
              :initial-customer="customer"
              :prefill="prefill"
            />
          </div>
        </ScreenSection>
      </form>
    </EntityScreen>
  </AppLayout>
</template>
