<script setup lang="ts">
/**
 * A screen's actions as the server declared them (docs/ui.md "Actions"):
 * on desktop the header's buttons read secondary, primary, "⋯"; on the
 * phone up to two secondary buttons and a square "⋯" make the black
 * header's action row, and the primary is a bar fixed at the bottom of the
 * screen. The same elements serve both: only their styles change at 768px.
 *
 * A `post` action asks first when it has a question (destructive or
 * irreversible ones); a `dialog` action is the page's own short form,
 * opened through the `dialog` event; a `submit` action submits the page's
 * form whose id it names (Save, on a screen in edit mode); a disabled one
 * shows its reason.
 */
import { computed, ref, useId } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { Ellipsis } from 'lucide-vue-next'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import { arrangeActions, type ScreenAction } from '@shared/screen_actions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import ConfirmDialog from './confirm_dialog.vue'

const props = defineProps<{ actions: ScreenAction[] }>()
const emit = defineEmits<{ dialog: [name: string] }>()

const arranged = computed(() => arrangeActions(props.actions))
const id = useId()
const reasonId = (action: ScreenAction) => `${id}-${action.name}-reason`

// The action asked about, kept while the dialog fades out
const confirming = ref<ScreenAction | null>(null)
const confirmOpen = ref(false)

function run(action: ScreenAction) {
  if (action.disabledReason) return
  if (action.kind === 'dialog') {
    emit('dialog', action.name)
  } else if (action.kind === 'post' && action.confirm) {
    confirming.value = action
    confirmOpen.value = true
  } else if (action.kind === 'post') {
    router.post(action.href!)
  } else if (action.kind === 'submit') {
    const form = document.getElementById(action.form!)
    if (form instanceof HTMLFormElement) form.requestSubmit()
  }
}

/** From "⋯": once the menu has closed, so the dialog opened next keeps the focus */
function runFromMenu(action: ScreenAction) {
  setTimeout(() => run(action))
}

function confirmed() {
  confirmOpen.value = false
  if (confirming.value) router.post(confirming.value.href!)
}

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-sidebar-brand'
const DISABLED = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60'
/** On the black band on the phone, bordered on white from 768px */
const SECONDARY = cn(
  'inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-sidebar-border bg-sidebar-accent px-4 text-sm font-semibold whitespace-nowrap text-white md:h-9 md:border-border md:bg-card md:text-foreground md:hover:bg-background md:focus-visible:ring-ring',
  FOCUS,
  DISABLED
)
const PRIMARY = cn(
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 text-[15px] font-semibold whitespace-nowrap text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:h-9 md:w-auto md:text-sm',
  'outline-none',
  DISABLED
)
const REASON = 'text-xs text-sidebar-foreground md:text-muted-foreground'
</script>

<template>
  <div
    :class="
      cn(
        'mt-1 flex items-start gap-2 md:mt-0 md:flex-wrap md:justify-end',
        !arranged.secondary.length && !arranged.overflow.length && 'max-md:contents'
      )
    "
  >
    <div
      v-for="action in arranged.secondary"
      :key="action.name"
      class="flex min-w-0 flex-1 flex-col gap-1 md:flex-none"
    >
      <Link
        v-if="action.kind === 'link' && !action.disabledReason"
        :href="action.href!"
        :class="SECONDARY"
      >
        {{ action.label }}
      </Link>
      <button
        v-else
        type="button"
        :class="SECONDARY"
        :aria-disabled="action.disabledReason ? 'true' : undefined"
        :aria-describedby="action.disabledReason ? reasonId(action) : undefined"
        @click="run(action)"
      >
        {{ action.label }}
      </button>
      <span v-if="action.disabledReason" :id="reasonId(action)" :class="REASON">
        {{ action.disabledReason }}
      </span>
    </div>

    <!-- The primary: a bar fixed at the bottom on the phone, a black button from 768px -->
    <div
      v-if="arranged.primary"
      data-testid="primary-action"
      class="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-1.5 border-t border-border bg-card px-3.5 py-2.5 md:static md:z-auto md:items-end md:gap-1 md:border-0 md:bg-transparent md:p-0"
    >
      <span
        v-if="arranged.primary.disabledReason"
        :id="reasonId(arranged.primary)"
        class="order-first text-center text-xs text-muted-foreground md:order-last md:text-right"
      >
        {{ arranged.primary.disabledReason }}
      </span>
      <Link
        v-if="arranged.primary.kind === 'link' && !arranged.primary.disabledReason"
        :href="arranged.primary.href!"
        :class="PRIMARY"
      >
        {{ arranged.primary.label }}
      </Link>
      <button
        v-else
        type="button"
        :class="PRIMARY"
        :aria-disabled="arranged.primary.disabledReason ? 'true' : undefined"
        :aria-describedby="arranged.primary.disabledReason ? reasonId(arranged.primary) : undefined"
        @click="run(arranged.primary)"
      >
        {{ arranged.primary.label }}
      </button>
    </div>

    <DropdownMenu v-if="arranged.overflow.length" :modal="false">
      <DropdownMenuTrigger
        :class="cn(SECONDARY, 'w-11 shrink-0 px-0 md:w-9')"
        :aria-label="t('ui.screen.moreActions')"
      >
        <Ellipsis class="size-[18px]" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <template v-for="action in arranged.overflow" :key="action.name">
          <DropdownMenuItem v-if="action.kind === 'link' && !action.disabledReason" as-child>
            <Link :href="action.href!">{{ action.label }}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            v-else
            :disabled="!!action.disabledReason"
            @select="runFromMenu(action)"
          >
            <span>{{ action.label }}</span>
            <span v-if="action.disabledReason" class="text-xs text-muted-foreground">
              {{ action.disabledReason }}
            </span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="confirming?.label ?? ''"
      :description="confirming?.confirm ?? ''"
      :confirm-label="confirming?.label ?? ''"
      @confirm="confirmed"
    />
  </div>
</template>
