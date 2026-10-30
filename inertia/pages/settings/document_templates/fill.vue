<script setup lang="ts">
/**
 * "Try with real data", a screen under the template it tries (docs/ui.md
 * "Settings"): its fields filled for a Customer, then the document as it
 * would print. Nothing is saved, so the header has no actions.
 */
import { ref } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import TemplateDataForm from '~/components/template_data_form.vue'
import { postJson, urlFor } from '~/client'
import { t } from '~/i18n'
import type { TemplateField } from '@shared/document_templates'
import { Button } from '~/components/ui/button'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import { TOUCH } from '~/components/screen/screen'

const props = defineProps<{
  template: { id: number; name: string; fields: TemplateField[] }
}>()

const title = t('ui.documentTemplates.fill.title', { name: props.template.name })
const crumbs = [
  { label: t('ui.settings.title'), href: urlFor('company_settings.edit') },
  { label: t('ui.settings.documentTemplates'), href: urlFor('document_templates.index') },
  {
    label: props.template.name,
    href: urlFor('document_templates.edit', { id: props.template.id }),
  },
]

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
    <EntityScreen
      :document-title="title"
      :crumbs="crumbs"
      :current="t('ui.documentTemplates.tryWithData')"
      :title="title"
    >
      <ScreenSection
        :title="t('ui.documentTemplates.fields')"
        :description="t('ui.documentTemplates.fill.description')"
      >
        <!-- Shared with issuing a document, which is not on the new UI yet -->
        <div>
          <TemplateDataForm ref="form" :fields="template.fields" :errors="errors" />
        </div>
      </ScreenSection>

      <ScreenSection :title="t('ui.documentTemplates.preview')">
        <template #actions>
          <Button variant="outline" :class="TOUCH" :disabled="rendering" @click="render">
            {{ t('ui.documentTemplates.fill.render') }}
          </Button>
        </template>
        <p v-if="failed" class="m-0 flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
          {{ t('ui.documentTemplates.fill.failed') }}
        </p>
        <!-- No scripts and no same-origin access: the preview only displays -->
        <iframe
          v-if="html"
          class="h-[520px] w-full rounded-sm border border-border bg-white"
          sandbox=""
          :srcdoc="html"
          :title="t('ui.documentTemplates.preview')"
          data-testid="template-preview"
        />
      </ScreenSection>
    </EntityScreen>
  </AppLayout>
</template>
