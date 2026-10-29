import type { WorkReportOptions } from './work_report.js'

/**
 * Document Templates (#29, #30): the body is a TipTap (ProseMirror) document
 * stored as JSON, never as HTML. It is checked against an allow-list of
 * node and mark types and rendered to HTML here, escaping every text, so
 * nothing a user writes or pastes can reach the PDF renderer as markup.
 * Pure: used by the server (validation, rendering) and the editor page.
 */

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'boolean',
  'choice',
  'site',
  'equipment',
  'job',
  'item',
  'items',
  'table',
  'work_report',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/**
 * The fields printed as a table in the body (a fieldTable): a table Office
 * fills in, or a Job's work report (#180), filled from the Job.
 */
export function isTableField(type: unknown) {
  return type === 'table' || type === 'work_report'
}

export const TABLE_COLUMN_TYPES = ['text', 'number', 'date'] as const
export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number]

/**
 * What "load from Job" puts in a column, for each Item used on the Job.
 */
export const TABLE_COLUMN_SOURCES = ['code', 'description', 'unit', 'quantity'] as const
export type TableColumnSource = (typeof TABLE_COLUMN_SOURCES)[number]

export const MAX_TABLE_COLUMNS = 10

export type TableColumn = {
  key: string
  label: string
  type: TableColumnType
  from?: TableColumnSource
}

/**
 * A value the template asks for when a document is issued.
 */
export type TemplateField = {
  key: string
  label: string
  type: FieldType
  required: boolean
  // The choices of a `choice` field
  options?: string[]
  // The columns of a `table` field
  columns?: TableColumn[]
}

/**
 * A field's value as the filling form starts with it (a replacement is
 * prefilled from its original): text as typed, a chosen record with its
 * label, a list of Items, a table's rows, or a work report's options.
 */
export type TemplatePrefill =
  | string
  | boolean
  | { id: number; label: string }
  | { id: number; label: string }[]
  | string[][]
  | WorkReportOptions

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

/**
 * Data every document has, besides the template's own fields
 * (`field.<key>`).
 */
export const BUILT_IN_PLACEHOLDERS = ['company.name', 'recipient.name', 'today'] as const

/**
 * The fields that pick a record, and the parts of it a placeholder can
 * print as `field.<key>.<property>`; `field.<key>` alone prints its usual
 * label.
 */
export const ENTITY_PROPERTIES = {
  site: ['address', 'city'],
  equipment: ['make', 'model', 'serial_number', 'installed_on'],
  job: ['number', 'title'],
  item: ['code', 'description'],
  items: [],
} as const satisfies Record<string, readonly string[]>
export type EntityFieldType = keyof typeof ENTITY_PROPERTIES

export function isEntityFieldType(type: unknown): type is EntityFieldType {
  return typeof type === 'string' && Object.hasOwn(ENTITY_PROPERTIES, type)
}

export type TemplateNode = {
  type: string
  attrs?: Record<string, string | number | boolean | null>
  content?: TemplateNode[]
  marks?: { type: string }[]
  text?: string
}

const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'horizontalRule']
const INLINE = ['text', 'hardBreak', 'placeholder']

/**
 * The allow-list: for each node type, the children it may hold and the
 * attributes it may carry (with a check per attribute). Anything else, in
 * a node or a mark, is refused.
 */
const NODE_RULES: Record<
  string,
  { children: string[]; attrs: Record<string, (v: unknown) => boolean> }
> = {
  // A table field's rows (fieldTable) only at the top level, not in a list
  doc: { children: [...BLOCKS, 'fieldTable'], attrs: {} },
  paragraph: { children: INLINE, attrs: {} },
  heading: { children: INLINE, attrs: { level: (v) => v === 1 || v === 2 || v === 3 } },
  bulletList: { children: ['listItem'], attrs: {} },
  orderedList: {
    children: ['listItem'],
    attrs: {
      start: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10_000,
      type: (v) => v === null || v === '1',
    },
  },
  // Like TipTap's listItem: a paragraph, then any blocks
  listItem: { children: BLOCKS, attrs: {} },
  text: { children: [], attrs: {} },
  hardBreak: { children: [], attrs: {} },
  horizontalRule: { children: [], attrs: {} },
  placeholder: {
    children: [],
    attrs: {
      key: (v) => typeof v === 'string',
      label: (v) => v === null || (typeof v === 'string' && v.length <= 100),
    },
  },
  fieldTable: {
    children: [],
    attrs: {
      key: (v) => typeof v === 'string',
      label: (v) => v === null || (typeof v === 'string' && v.length <= 100),
    },
  },
}
const MARKS = new Set(['bold', 'italic', 'underline'])
const NODE_KEYS = new Set(['type', 'attrs', 'content', 'marks', 'text'])

/**
 * The placeholders of one field: `field.<key>`, then one per property of
 * an entity field. A table field has none: its rows go in a fieldTable. A
 * work report's rows go there too; `field.<key>` prints its period.
 */
export function fieldPlaceholders(field: Pick<TemplateField, 'key' | 'type'>) {
  if (field.type === 'table') return []
  const properties: readonly string[] = isEntityFieldType(field.type)
    ? ENTITY_PROPERTIES[field.type]
    : []
  return [
    { key: `field.${field.key}`, property: null as string | null },
    ...properties.map((property) => ({ key: `field.${field.key}.${property}`, property })),
  ]
}

/**
 * The placeholders a template may use: the built-in ones and its fields'.
 */
export function placeholderKeys(fields: Pick<TemplateField, 'key' | 'type'>[]) {
  return [
    ...BUILT_IN_PLACEHOLDERS,
    ...fields.flatMap((field) => fieldPlaceholders(field).map(({ key }) => key)),
  ]
}

/**
 * The fields a template may repeat as a table in its body.
 */
export function tableKeys(fields: Pick<TemplateField, 'key' | 'type'>[]) {
  return fields.filter((field) => isTableField(field.type)).map((field) => field.key)
}

/**
 * `record[key]` only when the record itself has it: a field keyed
 * `constructor` must not read Object.prototype.
 */
export function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Whether `doc` is a template body made only of allowed nodes, nesting,
 * attributes and marks, whose placeholders and tables all exist.
 */
export function isValidTemplateBody(
  doc: unknown,
  allowedPlaceholders: string[],
  allowedTables: string[] = []
) {
  const allowed = new Set(allowedPlaceholders)
  const tables = new Set(allowedTables)
  const check = (node: unknown, parent: string | null, depth: number): boolean => {
    if (depth > 20 || !isObject(node)) return false
    if (!Object.keys(node).every((key) => NODE_KEYS.has(key))) return false
    const { type, attrs, content, marks, text } = node
    if (typeof type !== 'string' || !Object.hasOwn(NODE_RULES, type)) return false
    if (parent === null ? type !== 'doc' : !NODE_RULES[parent].children.includes(type)) return false
    const rules = NODE_RULES[type]

    if (attrs !== undefined) {
      if (!isObject(attrs)) return false
      for (const [name, value] of Object.entries(attrs)) {
        if (!Object.hasOwn(rules.attrs, name) || !rules.attrs[name](value)) return false
      }
    }
    if (type === 'heading' && !(isObject(attrs) && Object.hasOwn(attrs, 'level'))) return false
    if (type === 'placeholder' && !(isObject(attrs) && allowed.has(String(attrs.key)))) return false
    if (type === 'fieldTable' && !(isObject(attrs) && tables.has(String(attrs.key)))) return false
    if ((type === 'text') !== (typeof text === 'string')) return false
    if (type === 'text' && (text as string).length === 0) return false

    if (marks !== undefined) {
      if (type !== 'text' || !Array.isArray(marks)) return false
      const validMark = (mark: unknown) =>
        isObject(mark) &&
        MARKS.has(String(mark.type)) &&
        Object.keys(mark).every(
          (key) =>
            key === 'type' ||
            (key === 'attrs' && isObject(mark.attrs) && Object.keys(mark.attrs).length === 0)
        )
      if (!marks.every(validMark)) return false
    }
    if (content === undefined) return true
    if (!Array.isArray(content) || rules.children.length === 0) return false
    return content.every((child) => check(child, type, depth + 1))
  }
  return check(doc, null, 0)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const MARK_TAGS: Record<string, string> = { bold: 'strong', italic: 'em', underline: 'u' }
const BLOCK_TAGS: Record<string, string> = {
  paragraph: 'p',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
}

/**
 * A table field as printed: its column labels and its rows of cells.
 */
export type TableData = { headers: string[]; rows: string[][] }

function renderTable(table: TableData | undefined) {
  if (!table) return ''
  const cells = (tag: string, row: string[]) =>
    row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('')
  const rows = table.rows.map((row) => `<tr>${cells('td', row)}</tr>`).join('')
  return `<table class="field-table"><thead><tr>${cells('th', table.headers)}</tr></thead><tbody>${rows}</tbody></table>`
}

/**
 * The body as HTML, placeholders replaced by `values` and table fields by
 * `tables` (missing ones stay empty). Only call it with a body
 * `isValidTemplateBody` accepted.
 */
export function renderTemplateBody(
  doc: TemplateNode,
  values: Record<string, string>,
  tables: Record<string, TableData> = {}
): string {
  const children = (node: TemplateNode) =>
    (node.content ?? []).map((child) => renderTemplateBody(child, values, tables)).join('')
  switch (doc.type) {
    case 'doc':
      return children(doc)
    case 'text':
      return (doc.marks ?? []).reduce(
        (html, mark) => {
          const tag = MARK_TAGS[mark.type]
          return tag ? `<${tag}>${html}</${tag}>` : html
        },
        escapeHtml(doc.text ?? '')
      )
    case 'placeholder':
      return escapeHtml(own(values, String(doc.attrs?.key)) ?? '')
    case 'fieldTable':
      return renderTable(own(tables, String(doc.attrs?.key)))
    case 'heading': {
      const level = [1, 2, 3].includes(Number(doc.attrs?.level)) ? Number(doc.attrs?.level) : 2
      return `<h${level}>${children(doc)}</h${level}>`
    }
    case 'hardBreak':
      return '<br>'
    case 'horizontalRule':
      return '<hr>'
    default: {
      const tag = BLOCK_TAGS[doc.type]
      return tag ? `<${tag}>${children(doc)}</${tag}>` : ''
    }
  }
}

// The live preview's sample records, by property ('' is the usual label)
const SAMPLE_ENTITIES: Record<EntityFieldType, Record<string, string>> = {
  site: {
    '': 'Casa al mare — Via Roma 1, 20121 Milano (MI)',
    'address': 'Via Roma 1, 20121 Milano (MI)',
    'city': 'Milano',
  },
  equipment: {
    '': 'Caldaia — Vaillant ecoTEC plus',
    'make': 'Vaillant',
    'model': 'ecoTEC plus',
    'serial_number': 'SN-0012345',
  },
  job: {
    '': '2026/0001 – Sostituzione caldaia',
    'number': '2026/0001',
    'title': 'Sostituzione caldaia',
  },
  item: { '': 'Valvola a sfera 1/2"', 'code': 'VS-012', 'description': 'Valvola a sfera 1/2"' },
  items: { '': 'Valvola a sfera 1/2", Raccordo a T 3/4"' },
}
const SAMPLE_ITEMS = [
  { code: 'VS-012', description: 'Valvola a sfera 1/2"', unit: 'pz', quantity: '2' },
  { code: 'RT-034', description: 'Raccordo a T 3/4"', unit: 'pz', quantity: '1' },
]

/**
 * Placeholder values for the live preview: sample data for every field,
 * `workReportPeriod` for a work report's period.
 */
export function sampleValues(
  fields: TemplateField[],
  context: { companyName: string; today: string; workReportPeriod: string }
): Record<string, string> {
  const sample: Record<string, (field: TemplateField) => string> = {
    text: () => 'Testo di esempio',
    long_text: () => 'Un testo di esempio più lungo, su più righe.',
    number: () => '123',
    date: () => context.today,
    boolean: () => 'Sì',
    choice: (field) => field.options?.[0] ?? '',
    work_report: () => context.workReportPeriod,
  }
  const valuesOf = (field: TemplateField): [string, string][] => {
    if (!isEntityFieldType(field.type)) {
      return fieldPlaceholders(field).map(({ key }) => [key, sample[field.type](field)])
    }
    const entity: Record<string, string> = {
      installed_on: context.today,
      ...SAMPLE_ENTITIES[field.type],
    }
    return fieldPlaceholders(field).map(({ key, property }) => [key, entity[property ?? '']])
  }
  return {
    'company.name': context.companyName,
    'recipient.name': 'Mario Rossi',
    'today': context.today,
    ...Object.fromEntries(fields.flatMap(valuesOf)),
  }
}

/**
 * Sample rows for each table field of the live preview, and a sample work
 * report printed with `workReport`'s words.
 */
export function sampleTables(
  fields: TemplateField[],
  context: { today: string; workReport: TableData }
): Record<string, TableData> {
  const sample = { text: 'Testo di esempio', number: '123', date: context.today }
  return Object.fromEntries(
    fields
      .filter((field) => isTableField(field.type))
      .map((field) => {
        if (field.type === 'work_report') return [field.key, context.workReport]
        const columns = field.columns ?? []
        return [
          field.key,
          {
            headers: columns.map((column) => column.label),
            rows: SAMPLE_ITEMS.map((item) =>
              columns.map((column) => (column.from ? item[column.from] : sample[column.type]))
            ),
          },
        ]
      })
  )
}
