<script setup lang="ts">
/**
 * Searches active Items by code, description or supplier code and emits
 * the chosen one. Never shows prices, so it is safe for every role.
 */
import { onBeforeUnmount, ref, useId, watch } from 'vue'
import { urlFor } from '~/client'
import { t } from '~/i18n'

export type PickedItem = {
  id: number
  code: string
  description: string
  unit: string
  maintenanceIntervalMonths: number | null
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
  <div class="field">
    <label class="field__label" :for="inputId">{{ label ?? t('ui.items.picker.label') }}</label>
    <input
      :id="inputId"
      v-model="query"
      type="search"
      class="field__input"
      :placeholder="t('ui.items.picker.placeholder')"
      autocomplete="off"
    />
    <ul
      v-if="results.length"
      class="picker__results"
      role="listbox"
      :aria-label="t('ui.items.title')"
    >
      <li v-for="item in results" :key="item.id">
        <button type="button" class="picker__option" role="option" @click="choose(item)">
          <span
            ><span class="mono">{{ item.code }}</span> · {{ item.description }}</span
          >
        </button>
      </li>
    </ul>
    <p v-else-if="status === 'failed'" class="field__error">{{ t('ui.items.picker.failed') }}</p>
    <p v-else-if="query && status === 'done'" class="field__hint">
      {{ t('ui.items.picker.noMatches') }}
    </p>
  </div>
</template>
