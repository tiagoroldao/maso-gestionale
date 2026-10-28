/**
 * Document Templates (#29): the body is a TipTap (ProseMirror) document
 * stored as JSON, never as HTML. It is checked against an allow-list of
 * node and mark types and rendered to HTML here, escaping every text, so
 * nothing a user writes or pastes can reach the PDF renderer as markup.
 * Pure: used by the server (validation, rendering) and the editor page.
 */

export const FIELD_TYPES = ['text', 'long_text', 'number', 'date', 'boolean', 'choice'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

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
}

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

/**
 * Data every document has, besides the template's own fields
 * (`field.<key>`). Entity fields and tables come with #30.
 */
export const BUILT_IN_PLACEHOLDERS = ['company.name', 'recipient.name', 'today'] as const

export type TemplateNode = {
  type: string
  attrs?: Record<string, string | number | boolean | null>
  content?: TemplateNode[]
  marks?: { type: string }[]
  text?: string
}

const NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'bulletList',
  'orderedList',
  'listItem',
  'hardBreak',
  'horizontalRule',
  'placeholder',
])
const MARKS = new Set(['bold', 'italic', 'underline'])

/**
 * The placeholders a template may use: the built-in ones and its fields.
 */
export function placeholderKeys(fields: Pick<TemplateField, 'key'>[]) {
  return [...BUILT_IN_PLACEHOLDERS, ...fields.map((field) => `field.${field.key}`)]
}

/**
 * Whether `doc` is a template body made only of allowed nodes and marks,
 * whose placeholders all exist.
 */
export function isValidTemplateBody(doc: unknown, allowedPlaceholders: string[]) {
  const allowed = new Set(allowedPlaceholders)
  const check = (node: unknown, depth: number): boolean => {
    if (depth > 20 || typeof node !== 'object' || node === null) return false
    const { type, attrs, content, marks, text } = node as TemplateNode
    if (typeof type !== 'string' || !NODES.has(type)) return false
    if (type === 'text' && typeof text !== 'string') return false
    if (type === 'heading' && ![1, 2, 3].includes(Number(attrs?.level))) return false
    if (type === 'placeholder' && !allowed.has(String(attrs?.key))) return false
    if (marks !== undefined) {
      if (!Array.isArray(marks)) return false
      if (!marks.every((mark) => MARKS.has(mark?.type))) return false
    }
    if (content === undefined) return true
    return Array.isArray(content) && content.every((child) => check(child, depth + 1))
  }
  return check(doc, 0) && (doc as TemplateNode).type === 'doc'
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
 * The body as HTML, placeholders replaced by `values` (missing ones stay
 * empty). Only call it with a body `isValidTemplateBody` accepted.
 */
export function renderTemplateBody(doc: TemplateNode, values: Record<string, string>): string {
  const children = (node: TemplateNode) =>
    (node.content ?? []).map((child) => renderTemplateBody(child, values)).join('')
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
      return escapeHtml(values[String(doc.attrs?.key)] ?? '')
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

/**
 * Placeholder values for the live preview: sample data for every field.
 */
export function sampleValues(
  fields: TemplateField[],
  context: { companyName: string; today: string }
): Record<string, string> {
  const sample: Record<FieldType, (field: TemplateField) => string> = {
    text: () => 'Testo di esempio',
    long_text: () => 'Un testo di esempio più lungo, su più righe.',
    number: () => '123',
    date: () => context.today,
    boolean: () => 'Sì',
    choice: (field) => field.options?.[0] ?? '',
  }
  return {
    'company.name': context.companyName,
    'recipient.name': 'Mario Rossi',
    'today': context.today,
    ...Object.fromEntries(fields.map((field) => [`field.${field.key}`, sample[field.type](field)])),
  }
}
