<script setup lang="ts">
/**
 * The preview of a record referenced from another record's lines or
 * Charges (docs/ui.md "Hierarchy and references", mockup
 * "anteprima-phone"): a bottom sheet on the phone, a side panel on the
 * right from the tablet up, over the screen it was opened from. It is
 * modal: focus stays inside, Esc or "Chiudi" closes it and puts focus back
 * where it was, so the screen underneath is left as it was. "Apri scheda"
 * opens the record's page.
 *
 * The caller loads the record (`state`) and passes its name as on its
 * page (kind, title, the line under it), two or four facts in a
 * two-column grid, and anything else short in the default slot. When
 * loading failed, "Riprova" asks the caller to load it again (`retry`).
 */
import { ref, watch } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import { CircleAlert } from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import { buttonVariants } from '~/components/ui/button'
import { DIALOG_OVERLAY } from '~/components/ui/dialog'
import StatusTag from './status_tag.vue'
import { LABEL } from './screen'

/** A fact, with a tag under its value when it needs attention (negative stock) */
export type PreviewFact = { label: string; value: string; alert?: string }

withDefaults(
  defineProps<{
    /** The kind of record, above its name ("Articolo") */
    kind: string
    /** Its name; missing while it loads */
    title?: string
    /** The line under the name: its code and the like */
    subtitle?: string
    /** Its page, for "Apri scheda" */
    href: string
    /** A few facts the user acts on, two to a row */
    facts?: PreviewFact[]
    state?: 'loading' | 'ready' | 'failed'
  }>(),
  { title: undefined, subtitle: undefined, facts: () => [], state: 'ready' }
)
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ retry: [] }>()

// "Riprova" disappears while it loads again: focus moves to the panel's title
const panelTitle = ref<{ $el: HTMLElement } | null>(null)
function retry() {
  panelTitle.value?.$el.focus()
  emit('retry')
}

// Opened from a row rather than a trigger: focus goes back to what opened it
let opener: HTMLElement | null = null
watch(
  open,
  (isOpen) => {
    if (isOpen && document.activeElement instanceof HTMLElement) opener = document.activeElement
  },
  { flush: 'sync' }
)
function returnFocus(event: Event) {
  if (!opener?.isConnected) return
  event.preventDefault()
  opener.focus()
  opener = null
}

/** Phone: a sheet from the bottom. From 768px: a panel on the right, full height */
const PANEL =
  'fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3.5 overflow-y-auto rounded-t-[10px] bg-card px-4 pt-2 pb-[calc(18px+env(safe-area-inset-bottom))] font-sans text-card-foreground shadow-float outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 max-md:data-[state=closed]:slide-out-to-bottom max-md:data-[state=open]:slide-in-from-bottom md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[400px] md:gap-4 md:rounded-none md:border-l md:border-border md:p-5 md:pr-[calc(1.25rem+env(safe-area-inset-right))] md:data-[state=closed]:slide-out-to-right md:data-[state=open]:slide-in-from-right'
const button = (variant: 'default' | 'outline') =>
  cn(buttonVariants({ variant, size: 'touch' }), 'flex-1 md:h-9')
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay :class="DIALOG_OVERLAY" />
      <DialogContent
        :aria-describedby="undefined"
        :aria-busy="state === 'loading'"
        :class="PANEL"
        data-testid="record-preview"
        @close-auto-focus="returnFocus"
      >
        <div
          aria-hidden="true"
          class="h-1 w-10 shrink-0 self-center rounded-full bg-border md:hidden"
        />
        <div class="flex min-w-0 flex-col gap-1">
          <span v-if="title" :class="LABEL">{{ kind }}</span>
          <DialogTitle
            ref="panelTitle"
            tabindex="-1"
            class="m-0 text-lg font-bold break-words outline-none"
          >
            {{ title ?? kind }}
          </DialogTitle>
          <span v-if="subtitle" class="text-[13px] text-muted-foreground">{{ subtitle }}</span>
        </div>

        <p v-if="state === 'loading'" role="status" class="m-0 text-sm text-muted-foreground">
          {{ t('ui.screen.preview.loading') }}
        </p>
        <div v-else-if="state === 'failed'" class="flex flex-col items-start gap-2.5">
          <p role="alert" class="m-0 flex items-start gap-2 text-sm">
            <CircleAlert :size="18" aria-hidden="true" class="shrink-0 text-destructive" />
            {{ t('ui.screen.preview.failed') }}
          </p>
          <button type="button" :class="cn(button('outline'), 'flex-none')" @click="retry">
            {{ t('ui.screen.preview.retry') }}
          </button>
        </div>
        <template v-else>
          <dl
            v-if="facts.length"
            class="m-0 grid grid-cols-2 rounded-sm border border-border tabular-nums"
          >
            <div
              v-for="fact in facts"
              :key="fact.label"
              class="flex min-w-0 flex-col gap-1 border-border px-3.5 py-3 even:border-l nth-[n+3]:border-t"
            >
              <dt :class="LABEL">{{ fact.label }}</dt>
              <dd class="m-0 text-[17px] font-bold break-words">{{ fact.value }}</dd>
              <dd v-if="fact.alert" class="m-0">
                <StatusTag tone="orange">{{ fact.alert }}</StatusTag>
              </dd>
            </div>
          </dl>
          <slot />
        </template>

        <div class="flex gap-2 md:mt-auto">
          <Link :href="href" :class="button('outline')">{{ t('ui.screen.preview.openPage') }}</Link>
          <DialogClose :class="button('default')">{{ t('ui.screen.closeDialog') }}</DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
