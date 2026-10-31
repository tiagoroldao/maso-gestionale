import { mergeAttributes, Node } from '@tiptap/core'

/** A data chip in the body: the data it stands for, named, on a grey tag */
export const CHIP =
  'inline-block rounded-sm bg-grey-tint px-1.5 font-mono text-[0.9em] text-foreground'

/**
 * A data chip in a Document Template's body: `key` names the value it is
 * replaced with when the document is issued (shared/document_templates.ts).
 */
export const Placeholder = Node.create({
  name: 'placeholder',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key: { default: null },
      label: { default: null, rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-placeholder]', getAttrs: (el) => ({ key: el.dataset.placeholder }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-placeholder': node.attrs.key, 'class': CHIP }),
      node.attrs.label ?? node.attrs.key,
    ]
  },
})
