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
  doc: { children: BLOCKS, attrs: {} },
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
}
const MARKS = new Set(['bold', 'italic', 'underline'])
const NODE_KEYS = new Set(['type', 'attrs', 'content', 'marks', 'text'])

/**
 * The placeholders a template may use: the built-in ones and its fields.
 */
export function placeholderKeys(fields: Pick<TemplateField, 'key'>[]) {
  return [...BUILT_IN_PLACEHOLDERS, ...fields.map((field) => `field.${field.key}`)]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Whether `doc` is a template body made only of allowed nodes, nesting,
 * attributes and marks, whose placeholders all exist.
 */
export function isValidTemplateBody(doc: unknown, allowedPlaceholders: string[]) {
  const allowed = new Set(allowedPlaceholders)
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
