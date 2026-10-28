<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import TemplateEditor from '~/components/template_editor.vue'
import { postJson, urlFor } from '~/client'
import { t } from '~/i18n'
import {
  BUILT_IN_PLACEHOLDERS,
  FIELD_TYPES,
  MAX_TABLE_COLUMNS,
  TABLE_COLUMN_SOURCES,
  TABLE_COLUMN_TYPES,
  fieldPlaceholders,
  type FieldType,
  type TableColumn,
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

type ColumnRow = { key: string; label: string; type: TableColumn['type']; from: string }
type FieldRow = {
  key: string
  label: string
  type: FieldType
  required: boolean
  options: string
  columns: ColumnRow[]
}

const name = ref(props.template?.name ?? '')
const fields = reactive<FieldRow[]>(
  (props.template?.fields ?? []).map((field) => ({
    ...field,
    options: (field.options ?? []).join(', '),
    columns: (field.columns ?? []).map((column) => ({ ...column, from: column.from ?? '' })),
  }))
)

const bodyEditor = ref<InstanceType<typeof TemplateEditor> | null>(null)

function addField() {
  fields.push({ key: '', label: '', type: 'text', required: false, options: '', columns: [] })
}

function addColumn(field: FieldRow) {
  field.columns.push({ key: '', label: '', type: 'text', from: '' })
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
    ...(field.type === 'table' && {
      columns: field.columns.map((column) => ({
        key: column.key.trim(),
        label: column.label,
        type: column.type,
        ...(column.from && { from: column.from as TableColumn['from'] }),
      })),
    }),
  }))
}

const namedFields = computed(() =>
  fields
    .filter((field) => field.key.trim())
    .map((field) => ({ key: field.key.trim(), type: field.type, label: field.label || field.key }))
)
const placeholders = computed(() => [
  ...BUILT_IN_PLACEHOLDERS.map((key) => ({ key, label: t(`ui.documentTemplates.builtIn.${key}`) })),
  ...namedFields.value.flatMap((field) =>
    fieldPlaceholders(field).map(({ key, property }) => ({
      key,
      label: property
        ? t('ui.documentTemplates.propertyLabel', {
            field: field.label,
            property: t(`ui.documentTemplates.properties.${property}`),
          })
        : field.label,
    }))
  ),
])
const tables = computed(() => namedFields.value.filter((field) => field.type === 'table'))
const chosen = ref('')
const chosenTable = ref('')

function insertPlaceholder() {
  const placeholder = placeholders.value.find((p) => p.key === chosen.value)
  if (!placeholder) return
  bodyEditor.value?.insertPlaceholder(placeholder.key, placeholder.label)
  chosen.value = ''
}

function insertTable() {
  const table = tables.value.find((field) => field.key === chosenTable.value)
  if (!table) return
  bodyEditor.value?.insertTable(table.key, table.label)
  chosenTable.value = ''
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

async function refreshPreview() {
  try {
    const answer = await postJson<{ html: string }>(urlFor('document_templates.preview'), payload())
    previewFailed.value = answer?.status !== 200
    if (answer?.status === 200) previewHtml.value = answer.data.html
  } catch {
    previewFailed.value = true
  }
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
                <span v-if="errors[`fields.${index}.label`]" class="field__error">
                  {{ errors[`fields.${index}.label`] }}
                </span>
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
                <span v-if="errors[`fields.${index}.options`]" class="field__error">
                  {{ errors[`fields.${index}.options`] }}
                </span>
                <span v-if="errors[`fields.${index}.type`]" class="field__error">
                  {{ errors[`fields.${index}.type`] }}
                </span>
                <div v-if="field.type === 'table'">
                  <p class="field__label">{{ t('ui.documentTemplates.columns') }}</p>
                  <div v-for="(column, c) in field.columns" :key="c">
                    <input
                      v-model="column.key"
                      class="field__input mono"
                      :aria-label="
                        t('ui.documentTemplates.columnKeyOf', {
                          column: c + 1,
                          position: index + 1,
                        })
                      "
                      :placeholder="t('ui.documentTemplates.fieldKey')"
                    />
                    <input
                      v-model="column.label"
                      class="field__input"
                      :aria-label="
                        t('ui.documentTemplates.columnLabelOf', {
                          column: c + 1,
                          position: index + 1,
                        })
                      "
                      :placeholder="t('ui.documentTemplates.fieldLabel')"
                    />
                    <select
                      v-model="column.type"
                      class="field__input"
                      :aria-label="
                        t('ui.documentTemplates.columnTypeOf', {
                          column: c + 1,
                          position: index + 1,
                        })
                      "
                    >
                      <option v-for="type in TABLE_COLUMN_TYPES" :key="type" :value="type">
                        {{ t(`ui.documentTemplates.columnTypes.${type}`) }}
                      </option>
                    </select>
                    <select
                      v-model="column.from"
                      class="field__input"
                      :aria-label="
                        t('ui.documentTemplates.columnFromOf', {
                          column: c + 1,
                          position: index + 1,
                        })
                      "
                    >
                      <option value="">{{ t('ui.documentTemplates.columnNoSource') }}</option>
                      <option v-for="source in TABLE_COLUMN_SOURCES" :key="source" :value="source">
                        {{ t(`ui.documentTemplates.columnSources.${source}`) }}
                      </option>
                    </select>
                    <button
                      type="button"
                      class="btn btn--ghost btn--sm"
                      @click="field.columns.splice(c, 1)"
                    >
                      {{ t('ui.documentTemplates.removeColumn') }}
                    </button>
                    <template v-for="part in ['key', 'label', 'type', 'from']" :key="part">
                      <span
                        v-if="errors[`fields.${index}.columns.${c}.${part}`]"
                        class="field__error"
                      >
                        {{ errors[`fields.${index}.columns.${c}.${part}`] }}
                      </span>
                    </template>
                  </div>
                  <span v-if="errors[`fields.${index}.columns`]" class="field__error">
                    {{ errors[`fields.${index}.columns`] }}
                  </span>
                  <button
                    v-if="field.columns.length < MAX_TABLE_COLUMNS"
                    type="button"
                    class="btn btn--secondary btn--sm"
                    @click="addColumn(field)"
                  >
                    {{ t('ui.documentTemplates.addColumn') }}
                  </button>
                </div>
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
            <select
              v-if="tables.length"
              v-model="chosenTable"
              class="field__input"
              :aria-label="t('ui.documentTemplates.insertTable')"
              :style="{ maxWidth: '240px' }"
              @change="insertTable"
            >
              <option value="">{{ t('ui.documentTemplates.insertTable') }}</option>
              <option v-for="table in tables" :key="table.key" :value="table.key">
                {{ table.label }}
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
        <Link
          v-if="template"
          route="document_templates.fill"
          :params="{ id: template.id }"
          class="btn btn--secondary"
        >
          {{ t('ui.documentTemplates.tryWithData') }}
        </Link>
      </p>
    </SettingsLayout>
  </AppLayout>
</template>
