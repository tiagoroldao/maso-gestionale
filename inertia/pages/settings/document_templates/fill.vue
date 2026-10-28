<script setup lang="ts">
import { ref } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import TemplateDataForm from '~/components/template_data_form.vue'
import { postJson, urlFor } from '~/client'
import { t } from '~/i18n'
import type { TemplateField } from '@shared/document_templates'

const props = defineProps<{
  template: { id: number; name: string; fields: TemplateField[] }
}>()

const form = ref<InstanceType<typeof TemplateDataForm> | null>(null)
const errors = ref<Record<string, string>>({})
const html = ref('')
const failed = ref(false)
const rendering = ref(false)

async function render() {
  if (!form.value) return
  rendering.value = true
  try {
    const answer = await postJson<{ html: string } | { errors: Record<string, string> }>(
      urlFor('document_templates.fill_preview', { id: props.template.id }),
      form.value.input()
    )
    errors.value = answer && 'errors' in answer.data ? answer.data.errors : {}
    failed.value = answer?.status !== 200
    if (answer && 'html' in answer.data) html.value = answer.data.html
  } catch {
    failed.value = true
  } finally {
    rendering.value = false
  }
}
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section
        :title="t('ui.documentTemplates.fill.title', { name: template.name })"
        :description="t('ui.documentTemplates.fill.description')"
      >
        <p>
          <Link route="document_templates.edit" :params="{ id: template.id }" class="il">
            {{ t('ui.documentTemplates.fill.back') }}
          </Link>
        </p>
        <TemplateDataForm ref="form" :fields="template.fields" :errors="errors" />
      </Section>

      <Section :title="t('ui.documentTemplates.preview')">
        <p>
          <button
            type="button"
            class="btn btn--primary btn--sm"
            :disabled="rendering"
            @click="render"
          >
            {{ t('ui.documentTemplates.fill.render') }}
          </button>
          <span v-if="failed" class="field__error">
            {{ t('ui.documentTemplates.fill.failed') }}
          </span>
        </p>
        <!-- No scripts and no same-origin access: the preview only displays -->
        <iframe
          v-if="html"
          class="template-preview"
          sandbox=""
          :srcdoc="html"
          :title="t('ui.documentTemplates.preview')"
          data-testid="template-preview"
        />
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
