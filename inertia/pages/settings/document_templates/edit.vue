<script setup lang="ts">
/**
 * A Document Template's editor, an Entity screen in edit mode under
 * Modelli di documento (docs/ui.md "Settings"): its name, the fields to
 * fill, the body (the rich-text editor) and a preview with sample data.
 * The header's Save sends them; trying it with real data and archiving it
 * (or restoring an archived one) are the header's too, as the server
 * declares them.
 */
import { computed, reactive, ref } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import TemplateEditor from '~/components/template_editor.vue'
import { postJson, urlFor } from '~/client'
import { t } from '~/i18n'
import type { ScreenAction } from '@shared/screen_actions'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import FormField from '~/components/screen/form_field.vue'
import RowField from '~/components/screen/row_field.vue'
import RowHeads from '~/components/screen/row_heads.vue'
import RowErrors from '~/components/screen/row_errors.vue'
import { EDIT_ROW, EMPTY, TOUCH } from '~/components/screen/screen'
import {
  BUILT_IN_PLACEHOLDERS,
  FIELD_TYPES,
  MAX_TABLE_COLUMNS,
  TABLE_COLUMN_SOURCES,
  TABLE_COLUMN_TYPES,
  fieldPlaceholders,
  isTableField,
  type FieldType,
  type TableColumn,
  type TemplateField,
  type TemplateNode,
} from '@shared/document_templates'

const props = defineProps<{
  // Save, or Restore when archived; trying it with real data; archiving
  actions: ScreenAction[]
  template: {
    id: number
    name: string
    version: number
    body: TemplateNode
    fields: TemplateField[]
    archived: boolean
  } | null
}>()

const page = usePage()
const errors = computed(() => (page.props.errors ?? {}) as Record<string, string>)

const title = computed(() => props.template?.name ?? t('ui.documentTemplates.new'))
const crumbs = [
  { label: t('ui.settings.title'), href: urlFor('company_settings.edit') },
  { label: t('ui.settings.documentTemplates'), href: urlFor('document_templates.index') },
]

// A field's and a table column's errors show after their inputs (#226),
// each naming the input it is about
const fieldLabels = {
  key: t('ui.documentTemplates.columnKey'),
  label: t('ui.documentTemplates.columnLabel'),
  type: t('ui.documentTemplates.columnType'),
  options: t('ui.documentTemplates.fieldOptions'),
  columns: t('ui.documentTemplates.columns'),
}
const columnLabels = {
  key: t('ui.documentTemplates.columnKey'),
  label: t('ui.documentTemplates.columnLabel'),
  type: t('ui.documentTemplates.columnType'),
  from: t('ui.documentTemplates.columnFrom'),
}
/** The errors under `prefix` (a field's, a column's), by their last part */
function errorsOf(prefix: string, parts: Record<string, string>) {
  return Object.fromEntries(
    Object.keys(parts).map((part) => [part, errors.value[`${prefix}.${part}`]])
  )
}

// The fields' widths on desktop, under their column heads
const KEY = 'md:w-40'
const LABEL_WIDTH = 'md:w-56'
const TYPE = 'md:w-64'
const ERROR = 'm-0 flex items-start gap-1.5 text-sm text-destructive'
// The preview is a sheet of paper: white in both themes
const PREVIEW = 'h-[520px] w-full rounded-sm border border-border bg-white'

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
// Table fields and work reports, each printed as a table
const tables = computed(() => namedFields.value.filter((field) => isTableField(field.type)))
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

// Save, in the header, waits while the template is sent
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
    <EntityScreen
      :document-title="`${title} · ${t('ui.settings.documentTemplates')}`"
      :crumbs="crumbs"
      :current="title"
      :title="title"
      :facts="template ? t('ui.documentTemplates.version', { version: template.version }) : ''"
      :actions="actions"
      :busy="saving"
    >
      <template v-if="template?.archived" #tags>
        <StatusTag tone="grey">{{ t('ui.archive.archivedTag') }}</StatusTag>
      </template>

      <!-- save() sends it as JSON: the form lets the header's Save, and Enter, submit it -->
      <form id="document-template" class="flex flex-col gap-3 md:gap-5" @submit.prevent="save">
        <ScreenSection :title="t('ui.documentTemplates.templateSection')">
          <FormField
            id="template-name"
            v-slot="control"
            :label="t('ui.documentTemplates.name')"
            :error="errors.name"
            class="md:w-96"
          >
            <Input
              :id="control.id"
              v-model="name"
              :aria-invalid="control.invalid"
              :aria-describedby="control.describedBy"
              :class="TOUCH"
            />
          </FormField>
        </ScreenSection>

        <ScreenSection
          :title="t('ui.documentTemplates.fields')"
          :description="t('ui.documentTemplates.fieldsHint')"
          flush
        >
          <template #actions>
            <Button type="button" variant="outline" :class="TOUCH" @click="addField">
              {{ t('ui.documentTemplates.addField') }}
            </Button>
          </template>
          <RowHeads
            v-if="fields.length"
            :heads="[
              { label: t('ui.documentTemplates.columnKey'), class: KEY },
              { label: t('ui.documentTemplates.columnLabel'), class: LABEL_WIDTH },
              { label: t('ui.documentTemplates.columnType'), class: TYPE },
            ]"
          />
          <p v-else :class="EMPTY">{{ t('ui.documentTemplates.fill.noFields') }}</p>
          <ul class="m-0 list-none p-0">
            <li v-for="(field, index) in fields" :key="index" :class="EDIT_ROW">
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <div class="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-start">
                  <RowField :label="t('ui.documentTemplates.columnKey')" :class="KEY">
                    <Input
                      v-model="field.key"
                      :aria-label="t('ui.documentTemplates.fieldKeyOf', { position: index + 1 })"
                      :placeholder="t('ui.documentTemplates.fieldKey')"
                      :aria-invalid="errors[`fields.${index}.key`] ? 'true' : undefined"
                      :class="[TOUCH, 'font-mono']"
                    />
                  </RowField>
                  <RowField :label="t('ui.documentTemplates.columnLabel')" :class="LABEL_WIDTH">
                    <Input
                      v-model="field.label"
                      :aria-label="t('ui.documentTemplates.fieldLabelOf', { position: index + 1 })"
                      :placeholder="t('ui.documentTemplates.fieldLabel')"
                      :aria-invalid="errors[`fields.${index}.label`] ? 'true' : undefined"
                      :class="TOUCH"
                    />
                  </RowField>
                  <RowField :label="t('ui.documentTemplates.columnType')" :class="TYPE">
                    <NativeSelect
                      v-model="field.type"
                      :aria-label="t('ui.documentTemplates.fieldTypeOf', { position: index + 1 })"
                      :aria-invalid="errors[`fields.${index}.type`] ? 'true' : undefined"
                    >
                      <option v-for="type in FIELD_TYPES" :key="type" :value="type">
                        {{ t(`ui.documentTemplates.fieldTypes.${type}`) }}
                      </option>
                    </NativeSelect>
                  </RowField>
                  <RowField
                    v-if="field.type === 'choice'"
                    :label="t('ui.documentTemplates.fieldOptions')"
                    class="md:w-64"
                  >
                    <Input
                      v-model="field.options"
                      :aria-label="
                        t('ui.documentTemplates.fieldOptionsOf', { position: index + 1 })
                      "
                      :placeholder="t('ui.documentTemplates.fieldOptions')"
                      :aria-invalid="errors[`fields.${index}.options`] ? 'true' : undefined"
                      :class="TOUCH"
                    />
                  </RowField>
                  <label class="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
                    <input v-model="field.required" type="checkbox" class="size-4" />
                    {{ t('ui.documentTemplates.required') }}
                  </label>
                  <RowErrors
                    :errors="errorsOf(`fields.${index}`, fieldLabels)"
                    :fields="fieldLabels"
                  />
                </div>

                <!-- A table's columns, a line each under the field -->
                <div
                  v-if="field.type === 'table'"
                  class="flex flex-col gap-2 border-l-2 border-border pl-3"
                >
                  <p class="m-0 text-xs font-medium text-muted-foreground">
                    {{ t('ui.documentTemplates.columns') }}
                  </p>
                  <div
                    v-for="(column, c) in field.columns"
                    :key="c"
                    class="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-start"
                  >
                    <RowField :label="t('ui.documentTemplates.columnKey')" class="md:w-32">
                      <Input
                        v-model="column.key"
                        :aria-label="
                          t('ui.documentTemplates.columnKeyOf', {
                            column: c + 1,
                            position: index + 1,
                          })
                        "
                        :placeholder="t('ui.documentTemplates.fieldKey')"
                        :class="[TOUCH, 'font-mono']"
                      />
                    </RowField>
                    <RowField :label="t('ui.documentTemplates.columnLabel')" class="md:w-44">
                      <Input
                        v-model="column.label"
                        :aria-label="
                          t('ui.documentTemplates.columnLabelOf', {
                            column: c + 1,
                            position: index + 1,
                          })
                        "
                        :placeholder="t('ui.documentTemplates.fieldLabel')"
                        :class="TOUCH"
                      />
                    </RowField>
                    <RowField :label="t('ui.documentTemplates.columnType')" class="md:w-32">
                      <NativeSelect
                        v-model="column.type"
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
                      </NativeSelect>
                    </RowField>
                    <RowField :label="t('ui.documentTemplates.columnFrom')" class="md:w-56">
                      <NativeSelect
                        v-model="column.from"
                        :aria-label="
                          t('ui.documentTemplates.columnFromOf', {
                            column: c + 1,
                            position: index + 1,
                          })
                        "
                      >
                        <option value="">{{ t('ui.documentTemplates.columnNoSource') }}</option>
                        <option
                          v-for="source in TABLE_COLUMN_SOURCES"
                          :key="source"
                          :value="source"
                        >
                          {{ t(`ui.documentTemplates.columnSources.${source}`) }}
                        </option>
                      </NativeSelect>
                    </RowField>
                    <Button
                      type="button"
                      variant="ghost"
                      :class="TOUCH"
                      @click="field.columns.splice(c, 1)"
                    >
                      {{ t('ui.documentTemplates.removeColumn') }}
                    </Button>
                    <RowErrors
                      :errors="errorsOf(`fields.${index}.columns.${c}`, columnLabels)"
                      :fields="columnLabels"
                    />
                  </div>
                  <Button
                    v-if="field.columns.length < MAX_TABLE_COLUMNS"
                    type="button"
                    variant="outline"
                    :class="[TOUCH, 'self-start']"
                    @click="addColumn(field)"
                  >
                    {{ t('ui.documentTemplates.addColumn') }}
                  </Button>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                :class="[TOUCH, 'self-start']"
                @click="fields.splice(index, 1)"
              >
                {{ t('ui.documentTemplates.removeField') }}
              </Button>
            </li>
          </ul>
          <div v-if="errors.fields" class="px-3.5 pb-3 md:px-4">
            <RowErrors
              :errors="{ fields: errors.fields }"
              :fields="{ fields: t('ui.documentTemplates.fields') }"
            />
          </div>
        </ScreenSection>

        <ScreenSection :title="t('ui.documentTemplates.body')">
          <TemplateEditor ref="bodyEditor" :initial="template?.body ?? null">
            <template #toolbar>
              <NativeSelect
                v-model="chosen"
                :aria-label="t('ui.documentTemplates.insertPlaceholder')"
                class="md:w-60"
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
              </NativeSelect>
              <NativeSelect
                v-if="tables.length"
                v-model="chosenTable"
                :aria-label="t('ui.documentTemplates.insertTable')"
                class="md:w-60"
                @change="insertTable"
              >
                <option value="">{{ t('ui.documentTemplates.insertTable') }}</option>
                <option v-for="table in tables" :key="table.key" :value="table.key">
                  {{ table.label }}
                </option>
              </NativeSelect>
            </template>
          </TemplateEditor>
          <p v-if="errors.body" :class="ERROR">
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ errors.body }}
          </p>
        </ScreenSection>

        <ScreenSection :title="t('ui.documentTemplates.preview')">
          <template #actions>
            <Button type="button" variant="outline" :class="TOUCH" @click="refreshPreview">
              {{ t('ui.documentTemplates.refreshPreview') }}
            </Button>
          </template>
          <p v-if="previewFailed" :class="ERROR">
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ t('ui.documentTemplates.previewFailed') }}
          </p>
          <!-- No scripts and no same-origin access: the preview only displays -->
          <iframe
            v-if="previewHtml"
            :class="PREVIEW"
            sandbox=""
            :srcdoc="previewHtml"
            :title="t('ui.documentTemplates.preview')"
            data-testid="template-preview"
          />
        </ScreenSection>
      </form>
    </EntityScreen>
  </AppLayout>
</template>
