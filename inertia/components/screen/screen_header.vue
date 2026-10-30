<script setup lang="ts">
/**
 * A screen's header (docs/ui.md "Header"), its parts in order: where you
 * are, the title, status tags (the `tags` slot), one line of identifying
 * facts, the actions. On desktop a white band under a breadcrumb of the
 * canonical path (`crumbs`, then `current`); on the phone a black band
 * that continues the shell's bar, where "‹" (set here, shown by the shell
 * beside "☰") goes back to the canonical parent, the last crumb.
 */
import { inject, onBeforeUnmount, watchEffect } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import type { ScreenAction } from '@shared/screen_actions'
import ScreenActions from './screen_actions.vue'
import { LABEL, SHELL_BACK, type Crumb } from './screen'

const props = withDefaults(
  defineProps<{
    crumbs: Crumb[]
    /** The breadcrumb's last step: this record, as its parent lists it */
    current: string
    title: string
    facts?: string
    actions?: ScreenAction[]
    /** The screen's form is being submitted: Save waits */
    busy?: boolean
  }>(),
  { facts: '', actions: () => [], busy: false }
)
const emit = defineEmits<{ dialog: [name: string] }>()

const back = inject(SHELL_BACK, null)
watchEffect(() => {
  if (back) back.value = props.crumbs.at(-1) ?? null
})
onBeforeUnmount(() => {
  if (back) back.value = null
})
</script>

<template>
  <header
    class="bg-sidebar font-sans text-white tabular-nums md:border-b md:border-border md:bg-card md:text-foreground"
  >
    <div
      class="flex w-full max-w-[1220px] flex-col gap-2 px-4 pt-1 pb-4 md:gap-3 md:px-8 md:py-[22px]"
    >
      <nav :aria-label="t('ui.screen.breadcrumb')" class="hidden md:block">
        <ol :class="cn(LABEL, 'flex list-none flex-wrap items-center gap-1.5 p-0')">
          <template v-for="crumb in crumbs" :key="crumb.href">
            <li>
              <Link
                :href="crumb.href"
                class="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {{ crumb.label }}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
          </template>
          <li aria-current="page">{{ current }}</li>
        </ol>
      </nav>
      <div class="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-4">
        <div class="flex min-w-0 flex-col gap-2 md:flex-[1_1_320px]">
          <h1
            class="m-0 font-display text-[22px] leading-tight font-bold tracking-[0.01em] md:text-[26px]"
          >
            {{ title }}
          </h1>
          <div class="flex flex-wrap items-center gap-2 md:gap-2.5">
            <slot name="tags" />
            <span
              v-if="facts"
              class="text-[13px] text-sidebar-foreground md:text-sm md:text-muted-foreground"
            >
              {{ facts }}
            </span>
          </div>
        </div>
        <ScreenActions
          v-if="actions.length"
          :actions="actions"
          :busy="busy"
          @dialog="(name) => emit('dialog', name)"
        />
      </div>
    </div>
  </header>
</template>
