<script setup lang="ts">
/**
 * An Entity screen (docs/ui.md "Kinds of screen", "Entity screen body"):
 * the header, the key-facts band, then the sections. The `main` slot holds
 * the screen's main work and the `side` slot the supporting sections, side
 * by side on a wide screen; the default slot's sections run full width
 * below. Everything stacks on the phone, above the primary action's bar.
 */
import { computed } from 'vue'
import { Head } from '@inertiajs/vue3'
import type { ScreenAction } from '@shared/screen_actions'
import ScreenHeader from './screen_header.vue'
import KeyFacts, { type KeyFact } from './key_facts.vue'
import type { Crumb } from './screen'

const props = withDefaults(
  defineProps<{
    /** The browser tab's title */
    documentTitle: string
    crumbs: Crumb[]
    current: string
    title: string
    facts?: string
    actions?: ScreenAction[]
    keyFacts?: KeyFact[]
  }>(),
  { facts: '', actions: () => [], keyFacts: () => [] }
)
const emit = defineEmits<{ dialog: [name: string] }>()

// Room under the last section for the phone's bottom bar
const hasPrimary = computed(() => props.actions.some((action) => action.rank === 'primary'))
</script>

<template>
  <div class="w-full min-w-0 bg-background">
    <Head :title="documentTitle" />
    <ScreenHeader
      :crumbs="crumbs"
      :current="current"
      :title="title"
      :facts="facts"
      :actions="actions"
      @dialog="(name) => emit('dialog', name)"
    >
      <template #tags><slot name="tags" /></template>
    </ScreenHeader>
    <div
      :class="[
        'flex w-full max-w-[1220px] flex-col gap-3 p-3.5 md:gap-5 md:px-8 md:pt-5 md:pb-10',
        hasPrimary ? 'pb-24' : 'pb-6',
      ]"
    >
      <KeyFacts v-if="keyFacts.length" :facts="keyFacts" />
      <div v-if="$slots.main || $slots.side" class="flex flex-wrap items-start gap-3 md:gap-5">
        <div v-if="$slots.main" class="flex min-w-0 flex-[999_1_460px] flex-col gap-3 md:gap-5">
          <slot name="main" />
        </div>
        <div v-if="$slots.side" class="flex min-w-0 flex-[1_1_280px] flex-col gap-3 md:gap-5">
          <slot name="side" />
        </div>
      </div>
      <slot />
    </div>
  </div>
</template>
