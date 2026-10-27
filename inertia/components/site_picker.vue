<script setup lang="ts">
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
    <label class="field__label" :for="inputId">{{ label ?? 'Find a Site' }}</label>
    <input
      :id="inputId"
      v-model="query"
      type="search"
      class="field__input"
      placeholder="Street, city or label"
      autocomplete="off"
    />
    <ul v-if="results.length" class="picker__results" role="listbox" aria-label="Sites">
      <li v-for="site in results" :key="site.id">
        <button type="button" class="picker__option" role="option" @click="emit('select', site)">
          {{ site.summary }}
          <span v-if="site.linked" class="tag">linked</span>
        </button>
      </li>
    </ul>
    <p v-else-if="status === 'failed'" class="field__error">
      Couldn't search Sites. Reload the page and try again.
    </p>
    <p v-else-if="query && status === 'done'" class="field__hint">No Sites match.</p>
  </div>
</template>
