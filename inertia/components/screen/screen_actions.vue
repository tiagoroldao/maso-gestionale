<script setup lang="ts">
/**
 * A screen's actions as the server declared them (docs/ui.md "Actions"):
 * on desktop the header's buttons read secondary, primary, "⋯"; on the
 * phone up to two secondary buttons and a square "⋯" make the black
 * header's action row, and the primary is a bar fixed at the bottom of the
 * screen. The same elements serve both: only their styles change at 768px.
 *
 * A `post` action (a POST, or a DELETE when its `method` says so) asks
 * first when it has a question (destructive or irreversible ones); a
 * `dialog` action is the page's own short form, opened through the
 * `dialog` event; a `submit` action submits the form
 * the screen sits in, or the one its `form` names (disabled while it is
 * `busy`, or blocked); a disabled one shows its reason. A `link` outside
 * the app (a contact's `tel:`, a map) is a plain link, a web one opening in
 * a new tab; a `file` of the app is a plain link too, downloaded in place
 * or viewed in a new tab. A `post` holds the buttons of posts while it is
 * on its way, so it can't be sent twice.
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

const props = withDefaults(defineProps<{ actions: ScreenAction[]; busy?: boolean }>(), {
  busy: false,
})
const emit = defineEmits<{ dialog: [name: string] }>()

const arranged = computed(() => arrangeActions(props.actions))
const id = useId()
const reasonId = (action: ScreenAction) => `${id}-${action.name}-reason`

// The action asked about, kept while the dialog fades out
const confirming = ref<ScreenAction | null>(null)
const confirmOpen = ref(false)

/** A page of the app, opened by Inertia; anything else (a file, a contact) is a plain link */
const inApp = (action: ScreenAction) => action.href!.startsWith('/') && !action.file
/** A file to download stays in place; a file to view or a web page opens in a new tab */
const outside = (action: ScreenAction) => {
  if (action.file === 'download') return { download: '' }
  return action.file === 'view' || /^https?:/.test(action.href!)
    ? { target: '_blank', rel: 'noopener' }
    : {}
}

// A post or delete on its way: the header's buttons wait, so it isn't sent twice
const sending = ref(false)
/**
 * A button that can't be pressed now: a Save while its form is sent or
 * blocked, a post while one is on its way (a blocked post stays focusable,
 * marked aria-disabled, so its reason is read)
 */
const held = (action: ScreenAction) =>
  (action.kind === 'submit' && (props.busy || !!action.disabledReason)) ||
  (action.kind === 'post' && sending.value)

function run(action: ScreenAction) {
  if (action.disabledReason || action.kind === 'submit' || held(action)) return
  if (action.kind === 'dialog') {
    emit('dialog', action.name)
  } else if (action.kind === 'post' && action.confirm) {
    confirming.value = action
    confirmOpen.value = true
  } else if (action.kind === 'post') {
    send(action)
  }
}

/** A `post` action's request: a POST, or a DELETE when its method says so */
function send(action: ScreenAction) {
  if (sending.value) return
  sending.value = true
  const options = { onFinish: () => (sending.value = false) }
  if (action.method === 'delete') router.delete(action.href!, options)
  else router.post(action.href!, {}, options)
}

/** From "⋯": once the menu has closed, so the dialog opened next keeps the focus */
function runFromMenu(action: ScreenAction) {
  setTimeout(() => run(action))
}

function confirmed() {
  confirmOpen.value = false
  if (confirming.value) send(confirming.value)
}

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-sidebar-brand'
const DISABLED =
  'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60'
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
        v-if="action.kind === 'link' && !action.disabledReason && inApp(action)"
        :href="action.href!"
        :class="SECONDARY"
      >
        {{ action.label }}
      </Link>
      <a
        v-else-if="action.kind === 'link' && !action.disabledReason"
        :href="action.href!"
        v-bind="outside(action)"
        :class="SECONDARY"
      >
        {{ action.label }}
      </a>
      <button
        v-else
        :type="action.kind === 'submit' ? 'submit' : 'button'"
        :form="action.kind === 'submit' ? (action.form ?? undefined) : undefined"
        :disabled="held(action)"
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
        v-if="
          arranged.primary.kind === 'link' &&
          !arranged.primary.disabledReason &&
          inApp(arranged.primary)
        "
        :href="arranged.primary.href!"
        :class="PRIMARY"
      >
        {{ arranged.primary.label }}
      </Link>
      <a
        v-else-if="arranged.primary.kind === 'link' && !arranged.primary.disabledReason"
        :href="arranged.primary.href!"
        v-bind="outside(arranged.primary)"
        :class="PRIMARY"
      >
        {{ arranged.primary.label }}
      </a>
      <button
        v-else
        :type="arranged.primary.kind === 'submit' ? 'submit' : 'button'"
        :form="
          arranged.primary.kind === 'submit' ? (arranged.primary.form ?? undefined) : undefined
        "
        :disabled="held(arranged.primary)"
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
            <Link v-if="inApp(action)" :href="action.href!">{{ action.label }}</Link>
            <a v-else :href="action.href!" v-bind="outside(action)">{{ action.label }}</a>
          </DropdownMenuItem>
          <DropdownMenuItem
            v-else
            :disabled="!!action.disabledReason || held(action)"
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
