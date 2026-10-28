<script setup lang="ts">
/**
 * The rich-text body of a Document Template: TipTap limited to what the
 * server renders (shared/document_templates.ts), plus data chips.
 */
import { onBeforeUnmount } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '~/editor/placeholder'
import { t } from '~/i18n'
import type { TemplateNode } from '@shared/document_templates'

const props = defineProps<{ initial: TemplateNode | null }>()

// No code, links, quotes or raw HTML: pasted content keeps only these
const editor = useEditor({
  content: props.initial ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  extensions: [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      link: false,
      strike: false,
      heading: { levels: [1, 2, 3] },
    }),
    Placeholder,
  ],
  editorProps: { attributes: { class: 'template-editor' } },
})
onBeforeUnmount(() => editor.value?.destroy())

function insertPlaceholder(key: string, label: string) {
  editor.value?.chain().focus().insertContent({ type: 'placeholder', attrs: { key, label } }).run()
}

function body() {
  return editor.value?.getJSON() as TemplateNode | undefined
}

defineExpose({ insertPlaceholder, body })
</script>

<template>
  <div
    v-if="editor"
    :style="{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }"
  >
    <button
      type="button"
      class="btn btn--ghost btn--sm"
      @click="editor.chain().focus().toggleBold().run()"
    >
      {{ t('ui.documentTemplates.bold') }}
    </button>
    <button
      type="button"
      class="btn btn--ghost btn--sm"
      @click="editor.chain().focus().toggleItalic().run()"
    >
      {{ t('ui.documentTemplates.italic') }}
    </button>
    <button
      type="button"
      class="btn btn--ghost btn--sm"
      @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
    >
      {{ t('ui.documentTemplates.heading') }}
    </button>
    <button
      type="button"
      class="btn btn--ghost btn--sm"
      @click="editor.chain().focus().toggleBulletList().run()"
    >
      {{ t('ui.documentTemplates.bulletList') }}
    </button>
    <slot name="toolbar" />
  </div>
  <EditorContent :editor="editor" data-testid="template-body" />
</template>
