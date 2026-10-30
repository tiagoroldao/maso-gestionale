<script setup lang="ts">
/**
 * Searches active Items by code, description or supplier code and emits
 * the chosen one. Never shows prices, so it is safe for every role.
 */
import { onBeforeUnmount, ref, useId, watch } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import { urlFor } from '~/client'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  PICKER_ERROR,
  PICKER_HINT,
  PICKER_OPTION,
  PICKER_RESULTS,
} from '~/components/screen/screen'
import { t } from '~/i18n'

export type PickedItem = {
  id: number
  code: string
  description: string
  unit: string
  maintenanceIntervalMonths: number | null
  significantGood: boolean
  equipment: boolean
}

defineProps<{ label?: string }>()
const emit = defineEmits<{ select: [item: PickedItem] }>()

const inputId = useId()
const query = ref('')
const results = ref<PickedItem[]>([])
const status = ref<'idle' | 'loading' | 'done' | 'failed'>('idle')
let controller: AbortController | undefined
let timer: ReturnType<typeof setTimeout> | undefined

async function load() {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller

  try {
    const response = await fetch(
      `${urlFor('items.search')}?${new URLSearchParams({ q: query.value })}`,
      { headers: { accept: 'application/json' }, signal }
    )
    if (!response.ok) throw new Error(`Item search failed with ${response.status}`)
    const { items } = (await response.json()) as { items: PickedItem[] }
    if (signal.aborted) return
    results.value = items
    status.value = 'done'
  } catch {
    if (signal.aborted) return
    results.value = []
    status.value = 'failed'
  }
}

watch(query, (value) => {
  clearTimeout(timer)
  if (!value) {
    controller?.abort()
    results.value = []
    status.value = 'idle'
    return
  }
  status.value = 'loading'
  timer = setTimeout(load, 200)
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  controller?.abort()
})

function choose(item: PickedItem) {
  emit('select', item)
  query.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="inputId">{{ label ?? t('ui.items.picker.label') }}</Label>
    <Input
      :id="inputId"
      v-model="query"
      type="search"
      class="h-11 md:h-9"
      :placeholder="t('ui.items.picker.placeholder')"
      autocomplete="off"
    />
    <ul
      v-if="results.length"
      :class="PICKER_RESULTS"
      role="listbox"
      :aria-label="t('ui.items.title')"
    >
      <li v-for="item in results" :key="item.id">
        <button type="button" :class="PICKER_OPTION" role="option" @click="choose(item)">
          <span
            ><span class="font-semibold">{{ item.code }}</span> · {{ item.description }}</span
          >
        </button>
      </li>
    </ul>
    <p v-else-if="status === 'failed'" :class="PICKER_ERROR">
      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
      {{ t('ui.items.picker.failed') }}
    </p>
    <p v-else-if="query && status === 'done'" :class="PICKER_HINT">
      {{ t('ui.items.picker.noMatches') }}
    </p>
  </div>
</template>
