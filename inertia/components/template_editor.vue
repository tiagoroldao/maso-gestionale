<script setup lang="ts">
/**
 * The rich-text body of a Document Template: TipTap limited to what the
 * server renders (shared/document_templates.ts), plus data chips.
 */
import { onBeforeUnmount } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '~/editor/placeholder'
import { FieldTable, TemplateDocument } from '~/editor/field_table'
import { t } from '~/i18n'
import { Button } from '~/components/ui/button'
import { TOUCH } from '~/components/screen/screen'
import type { TemplateNode } from '@shared/document_templates'

const props = defineProps<{ initial: TemplateNode | null }>()

// No code, links, quotes or raw HTML: pasted content keeps only these
const editor = useEditor({
  content: props.initial ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  extensions: [
    StarterKit.configure({
      document: false,
      blockquote: false,
      code: false,
      codeBlock: false,
      link: false,
      strike: false,
      heading: { levels: [1, 2, 3] },
    }),
    TemplateDocument,
    Placeholder,
    FieldTable.configure({
      chipLabel: (label) => t('ui.documentTemplates.tableChip', { label }),
    }),
  ],
  editorProps: {
    attributes: { 'class': 'template-editor', 'aria-label': t('ui.documentTemplates.body') },
  },
})
onBeforeUnmount(() => editor.value?.destroy())

function insertPlaceholder(key: string, label: string) {
  editor.value?.chain().focus().insertContent({ type: 'placeholder', attrs: { key, label } }).run()
}

// A table field's rows, as a block of its own after the cursor's block
function insertTable(key: string, label: string) {
  editor.value?.chain().focus().insertContent({ type: 'fieldTable', attrs: { key, label } }).run()
}

function body() {
  return editor.value?.getJSON() as TemplateNode | undefined
}

defineExpose({ insertPlaceholder, insertTable, body })

type Editor = NonNullable<typeof editor.value>
const tools: { label: string; run: (on: Editor) => void }[] = [
  { label: t('ui.documentTemplates.bold'), run: (on) => on.chain().focus().toggleBold().run() },
  { label: t('ui.documentTemplates.italic'), run: (on) => on.chain().focus().toggleItalic().run() },
  {
    label: t('ui.documentTemplates.heading'),
    run: (on) => on.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: t('ui.documentTemplates.bulletList'),
    run: (on) => on.chain().focus().toggleBulletList().run(),
  },
]
</script>

<template>
  <!-- The editor's toolbar: plain buttons, each acting on the selection -->
  <div v-if="editor" class="mb-2 flex flex-wrap items-center gap-1.5">
    <Button
      v-for="tool in tools"
      :key="tool.label"
      type="button"
      variant="outline"
      :class="TOUCH"
      @click="tool.run(editor)"
    >
      {{ tool.label }}
    </Button>
    <slot name="toolbar" />
  </div>
  <EditorContent :editor="editor" data-testid="template-body" />
</template>
