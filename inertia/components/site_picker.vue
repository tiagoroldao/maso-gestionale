<script setup lang="ts">
import { t } from '~/i18n'
/**
 * Searches Sites for a Customer: the Customer's linked Sites come first,
 * and typing searches every Site. Emits the chosen Site.
 */
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { urlFor } from '~/client'

export type PickedSite = { id: number; summary: string; linked: boolean }

const props = defineProps<{ customerId?: number; label?: string; excludeIds?: number[] }>()
const emit = defineEmits<{ select: [site: PickedSite] }>()

const inputId = useId()
const query = ref('')
const results = ref<PickedSite[]>([])
const status = ref<'idle' | 'loading' | 'done' | 'failed'>('idle')
let controller: AbortController | undefined

async function load() {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller

  const params = new URLSearchParams()
  if (query.value) params.set('q', query.value)
  if (props.customerId) params.set('customerId', String(props.customerId))

  status.value = 'loading'
  try {
    const response = await fetch(`${urlFor('sites.search')}?${params}`, {
      headers: { accept: 'application/json' },
      signal,
    })
    if (!response.ok) throw new Error(`Site search failed with ${response.status}`)
    const { sites } = (await response.json()) as { sites: PickedSite[] }
    if (signal.aborted) return
    results.value = sites.filter((site) => !props.excludeIds?.includes(site.id))
    status.value = 'done'
  } catch {
    if (signal.aborted) return
    results.value = []
    status.value = 'failed'
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(timer)
  status.value = 'loading'
  timer = setTimeout(load, 200)
})
onMounted(load)
onBeforeUnmount(() => {
  clearTimeout(timer)
  controller?.abort()
})
</script>

<template>
  <div class="field">
    <label class="field__label" :for="inputId">{{ label ?? t('ui.sites.picker.label') }}</label>
    <input
      :id="inputId"
      v-model="query"
      type="search"
      class="field__input"
      :placeholder="t('ui.sites.picker.placeholder')"
      autocomplete="off"
    />
    <ul
      v-if="results.length"
      class="picker__results"
      role="listbox"
      :aria-label="t('ui.sites.picker.results')"
    >
      <li v-for="site in results" :key="site.id">
        <button type="button" class="picker__option" role="option" @click="emit('select', site)">
          {{ site.summary }}
          <span v-if="site.linked" class="tag">{{ t('ui.sites.picker.linked') }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="status === 'failed'" class="field__error">
      {{ t('ui.sites.picker.failed') }}
    </p>
    <p v-else-if="query && status === 'done'" class="field__hint">
      {{ t('ui.sites.picker.noMatches') }}
    </p>
  </div>
</template>
