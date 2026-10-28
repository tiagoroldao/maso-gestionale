<script setup lang="ts">
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import TemplateDataForm from '~/components/template_data_form.vue'
import type { PickedCustomer } from '~/components/customer_picker.vue'
import { postJson, urlFor } from '~/client'
import { t } from '~/i18n'
import type { TemplateField, TemplatePrefill } from '@shared/document_templates'

const props = defineProps<{
  templates: { id: number; name: string }[]
  template: { id: number; name: string; fields: TemplateField[] } | null
  customer: PickedCustomer | null
  replaces: { id: number; number: string } | null
  prefill: Record<string, TemplatePrefill>
}>()

const form = ref<InstanceType<typeof TemplateDataForm> | null>(null)
const errors = ref<Record<string, string>>({})
const failed = ref(false)
const issuing = ref(false)

const title = computed(() =>
  props.replaces
    ? t('ui.issuedDocuments.replaceTitle', { number: props.replaces.number })
    : t('ui.issuedDocuments.newTitle')
)

async function issue() {
  if (!form.value || !props.template) return
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
      router.visit(urlFor('issued_documents.show', { id: answer.data.id }))
      return
    }
    errors.value = answer && 'errors' in answer.data ? answer.data.errors : {}
    failed.value = true
  } catch {
    failed.value = true
  } finally {
    issuing.value = false
  }
}
</script>

<template>
  <AppLayout>
    <Page :title="title">
      <Section v-if="!template" :title="t('ui.issuedDocuments.chooseTemplate')">
        <p v-if="templates.length === 0" class="field__hint">
          {{ t('ui.issuedDocuments.noTemplates') }}
        </p>
        <table v-else class="table">
          <tbody>
            <tr v-for="one in templates" :key="one.id">
              <td>
                <Link
                  route="issued_documents.create"
                  :qs="
                    customer
                      ? { templateId: one.id, customerId: customer.id }
                      : { templateId: one.id }
                  "
                  class="il"
                >
                  {{ one.name }}
                </Link>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section v-else :title="template.name">
        <TemplateDataForm
          ref="form"
          :fields="template.fields"
          :errors="errors"
          :initial-customer="customer"
          :prefill="prefill"
        />
        <p>
          <button type="button" class="btn btn--primary" :disabled="issuing" @click="issue">
            {{ t('ui.issuedDocuments.issue') }}
          </button>
          <span v-if="errors.templateId" class="field__error">{{ errors.templateId }}</span>
          <span v-else-if="failed" class="field__error">
            {{ t('ui.issuedDocuments.failed') }}
          </span>
        </p>
      </Section>
    </Page>
  </AppLayout>
</template>
