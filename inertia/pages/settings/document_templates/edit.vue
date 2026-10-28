<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import TemplateEditor from '~/components/template_editor.vue'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import {
  BUILT_IN_PLACEHOLDERS,
  FIELD_TYPES,
  type FieldType,
  type TemplateField,
  type TemplateNode,
} from '@shared/document_templates'

const props = defineProps<{
  template: {
    id: number
    name: string
    version: number
    body: TemplateNode
    fields: TemplateField[]
  } | null
}>()

const page = usePage()
const errors = computed(() => (page.props.errors ?? {}) as Record<string, string>)

type FieldRow = { key: string; label: string; type: FieldType; required: boolean; options: string }

const name = ref(props.template?.name ?? '')
const fields = reactive<FieldRow[]>(
  (props.template?.fields ?? []).map((field) => ({
    ...field,
    options: (field.options ?? []).join(', '),
  }))
)

const bodyEditor = ref<InstanceType<typeof TemplateEditor> | null>(null)

function addField() {
  fields.push({ key: '', label: '', type: 'text', required: false, options: '' })
}

function fieldsInput(): TemplateField[] {
  return fields.map((field) => ({
    key: field.key.trim(),
    label: field.label,
    type: field.type,
    required: field.required,
    ...(field.type === 'choice' && {
      options: field.options
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean),
    }),
  }))
}

const placeholders = computed(() => [
  ...BUILT_IN_PLACEHOLDERS.map((key) => ({ key, label: t(`ui.documentTemplates.builtIn.${key}`) })),
  ...fields
    .filter((field) => field.key.trim())
    .map((field) => ({ key: `field.${field.key.trim()}`, label: field.label || field.key })),
])
const chosen = ref('')

function insertPlaceholder() {
  const placeholder = placeholders.value.find((p) => p.key === chosen.value)
  if (!placeholder) return
  bodyEditor.value?.insertPlaceholder(placeholder.key, placeholder.label)
  chosen.value = ''
}

function payload() {
  return { name: name.value, fields: fieldsInput(), body: bodyEditor.value?.body() ?? null }
}

const saving = ref(false)
function save() {
  const options = {
    preserveScroll: true,
    onStart: () => (saving.value = true),
    onFinish: () => (saving.value = false),
  }
  if (props.template) {
    router.put(urlFor('document_templates.update', { id: props.template.id }), payload(), options)
  } else {
    router.post(urlFor('document_templates.store'), payload(), options)
  }
}

const previewHtml = ref('')
const previewFailed = ref(false)

function xsrfToken() {
  const match = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

async function refreshPreview() {
  const response = await fetch(urlFor('document_templates.preview'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-XSRF-TOKEN': xsrfToken(),
    },
    body: JSON.stringify(payload()),
  })
  previewFailed.value = !response.ok
  if (response.ok) previewHtml.value = ((await response.json()) as { html: string }).html
}
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section
        :title="template ? template.name : t('ui.documentTemplates.new')"
        :description="
          template ? t('ui.documentTemplates.version', { version: template.version }) : undefined
        "
      >
        <div class="field">
          <label class="field__label" for="template-name">{{
            t('ui.documentTemplates.name')
          }}</label>
          <input id="template-name" v-model="name" class="field__input" />
          <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
        </div>
      </Section>

      <Section
        :title="t('ui.documentTemplates.fields')"
        :description="t('ui.documentTemplates.fieldsHint')"
      >
        <table v-if="fields.length" class="table">
          <tbody>
            <tr v-for="(field, index) in fields" :key="index">
              <td>
                <input
                  v-model="field.key"
                  class="field__input mono"
                  :aria-label="t('ui.documentTemplates.fieldKeyOf', { position: index + 1 })"
                  :placeholder="t('ui.documentTemplates.fieldKey')"
                />
                <span v-if="errors[`fields.${index}.key`]" class="field__error">
                  {{ errors[`fields.${index}.key`] }}
                </span>
              </td>
              <td>
                <input
                  v-model="field.label"
                  class="field__input"
                  :aria-label="t('ui.documentTemplates.fieldLabelOf', { position: index + 1 })"
                  :placeholder="t('ui.documentTemplates.fieldLabel')"
                />
              </td>
              <td>
                <select
                  v-model="field.type"
                  class="field__input"
                  :aria-label="t('ui.documentTemplates.fieldTypeOf', { position: index + 1 })"
                >
                  <option v-for="type in FIELD_TYPES" :key="type" :value="type">
                    {{ t(`ui.documentTemplates.fieldTypes.${type}`) }}
                  </option>
                </select>
                <input
                  v-if="field.type === 'choice'"
                  v-model="field.options"
                  class="field__input"
                  :aria-label="t('ui.documentTemplates.fieldOptionsOf', { position: index + 1 })"
                  :placeholder="t('ui.documentTemplates.fieldOptions')"
                />
              </td>
              <td>
                <label>
                  <input v-model="field.required" type="checkbox" />
                  {{ t('ui.documentTemplates.required') }}
                </label>
              </td>
              <td class="table__actions">
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  @click="fields.splice(index, 1)"
                >
                  {{ t('ui.documentTemplates.removeField') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <span v-if="errors.fields" class="field__error">{{ errors.fields }}</span>
        <button type="button" class="btn btn--secondary btn--sm" @click="addField">
          {{ t('ui.documentTemplates.addField') }}
        </button>
      </Section>

      <Section :title="t('ui.documentTemplates.body')">
        <TemplateEditor ref="bodyEditor" :initial="template?.body ?? null">
          <template #toolbar>
            <select
              v-model="chosen"
              class="field__input"
              :aria-label="t('ui.documentTemplates.insertPlaceholder')"
              :style="{ maxWidth: '240px' }"
              @change="insertPlaceholder"
            >
              <option value="">{{ t('ui.documentTemplates.insertPlaceholder') }}</option>
              <option
                v-for="placeholder in placeholders"
                :key="placeholder.key"
                :value="placeholder.key"
              >
                {{ placeholder.label }}
              </option>
            </select>
          </template>
        </TemplateEditor>
        <span v-if="errors.body" class="field__error">{{ errors.body }}</span>
      </Section>

      <Section :title="t('ui.documentTemplates.preview')">
        <p>
          <button type="button" class="btn btn--secondary btn--sm" @click="refreshPreview">
            {{ t('ui.documentTemplates.refreshPreview') }}
          </button>
          <span v-if="previewFailed" class="field__error">
            {{ t('ui.documentTemplates.previewFailed') }}
          </span>
        </p>
        <!-- No scripts and no same-origin access: the preview only displays -->
        <iframe
          v-if="previewHtml"
          class="template-preview"
          sandbox=""
          :srcdoc="previewHtml"
          :title="t('ui.documentTemplates.preview')"
          data-testid="template-preview"
        />
      </Section>

      <p>
        <button type="button" class="btn btn--primary" :disabled="saving" @click="save">
          {{ t('ui.documentTemplates.save') }}
        </button>
      </p>
    </SettingsLayout>
  </AppLayout>
</template>
