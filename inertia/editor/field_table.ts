import { mergeAttributes, Node } from '@tiptap/core'

/**
 * A table field's rows in a Document Template's body: `key` names the
 * field, printed as a table with a row per entry when the document is
 * issued (shared/document_templates.ts).
 */
export const FieldTable = Node.create<{ chipLabel: (label: string) => string }>({
  name: 'fieldTable',
  // Not 'block', so it can't go inside a list item
  group: 'fieldTable',
  atom: true,
  selectable: true,

  addOptions() {
    return { chipLabel: (label: string) => label }
  },

  addAttributes() {
    return {
      key: { default: null },
      label: { default: null, rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-field-table]', getAttrs: (el) => ({ key: el.dataset.fieldTable }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-field-table': node.attrs.key }),
      ['span', { class: 'chip' }, this.options.chipLabel(node.attrs.label ?? node.attrs.key)],
    ]
  },
})

/**
 * The body's top node: blocks, with table fields between them, as the
 * server allows (it replaces StarterKit's document).
 */
export const TemplateDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: '(block | fieldTable)+',
})
