<script setup lang="ts">
/**
 * A List screen (docs/ui.md "Kinds of screen", "Lists"), plain until the
 * lists design session (#237): the header, a top-level screen's (no parent,
 * so the phone's bar shows the logo, not "‹"), with the list's actions
 * ("Nuovo …" the primary); under it the list's search and filters
 * (`toolbar` slot), after an optional `description`, then the records in a
 * bordered box (default slot: a table on desktop, rows on the phone, each
 * opening its record), its `empty` line when there are none, and the pages.
 */
import { computed } from 'vue'
import { Head } from '@inertiajs/vue3'
import type { ScreenAction } from '@shared/screen_actions'
import ScreenHeader from './screen_header.vue'
import ListPagination, { type PaginationProps } from './list_pagination.vue'
import { LIST_BOX } from './screen'

const props = withDefaults(
  defineProps<{
    title: string
    actions?: ScreenAction[]
    description?: string
    /** No records: the line shown in place of the box's rows */
    empty?: string | null
    pagination?: PaginationProps | null
  }>(),
  { actions: () => [], description: '', empty: null, pagination: null }
)

// Room under the list for the phone's bottom bar
const hasPrimary = computed(() => props.actions.some((action) => action.rank === 'primary'))
</script>

<template>
  <div class="w-full min-w-0 bg-background">
    <Head :title="title" />
    <ScreenHeader :crumbs="[]" :current="title" :title="title" :actions="actions" />
    <div
      :class="[
        'flex w-full max-w-[1220px] flex-col gap-3 p-3.5 font-sans text-foreground md:gap-4 md:px-8 md:pt-5 md:pb-10',
        hasPrimary ? 'pb-24' : 'pb-6',
      ]"
    >
      <p v-if="description" class="m-0 text-[13px] text-muted-foreground">{{ description }}</p>
      <slot name="toolbar" />
      <div :class="LIST_BOX">
        <p v-if="empty" class="m-0 px-3.5 py-3 text-sm text-muted-foreground md:px-4">
          {{ empty }}
        </p>
        <slot v-else />
      </div>
      <ListPagination v-if="pagination" v-bind="pagination" />
    </div>
  </div>
</template>
