<script setup lang="ts">
/**
 * A list's search (docs/ui.md "Lists"): the field, named by `label`, any
 * filter sent with it (default slot), and "Cerca", which emits `search`.
 */
import { t } from '~/i18n'
import { Input } from '~/components/ui/input'
import { Button } from '~/components/ui/button'
import { TOUCH } from './screen'

defineProps<{ label: string; placeholder: string }>()
const query = defineModel<string>({ required: true })
const emit = defineEmits<{ search: [] }>()
</script>

<template>
  <form role="search" class="flex flex-wrap items-center gap-2" @submit.prevent="emit('search')">
    <Input
      v-model="query"
      type="search"
      :aria-label="label"
      :placeholder="placeholder"
      :class="['flex-[1_1_220px] md:max-w-sm', TOUCH]"
    />
    <slot />
    <Button type="submit" variant="outline" :class="TOUCH">{{ t('ui.common.search') }}</Button>
  </form>
</template>
