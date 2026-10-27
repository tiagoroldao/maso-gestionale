<script setup lang="ts">
/**
 * Searches Sites for a Customer: the Customer's linked Sites come first,
 * and typing searches every Site. Emits the chosen Site.
 */
import { onMounted, ref, watch } from 'vue'
import { urlFor } from '~/client'

export type PickedSite = { id: number; summary: string; linked: boolean }

const props = defineProps<{ customerId?: number; label?: string; excludeIds?: number[] }>()
const emit = defineEmits<{ select: [site: PickedSite] }>()

const query = ref('')
const results = ref<PickedSite[]>([])
let requestId = 0

async function load() {
  const id = ++requestId
  const params = new URLSearchParams()
  if (query.value) params.set('q', query.value)
  if (props.customerId) params.set('customerId', String(props.customerId))

  const response = await fetch(`${urlFor('sites.search')}?${params}`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok || id !== requestId) return
  const { sites } = (await response.json()) as { sites: PickedSite[] }
  results.value = sites.filter((site) => !props.excludeIds?.includes(site.id))
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(timer)
  timer = setTimeout(load, 200)
})
onMounted(load)
</script>

<template>
  <div class="field">
    <label class="field__label" for="site-picker">{{ label ?? 'Find a Site' }}</label>
    <input
      id="site-picker"
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
    <p v-else-if="query" class="field__hint">No Sites match.</p>
  </div>
</template>
