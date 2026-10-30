<script setup lang="ts">
import { t } from '~/i18n'
/**
 * Searches Sites for a Customer: the Customer's linked Sites come first,
 * and typing searches every Site. Emits the chosen Site.
 */
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import { urlFor } from '~/client'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import StatusTag from '~/components/screen/status_tag.vue'
import {
  PICKER_ERROR,
  PICKER_HINT,
  PICKER_OPTION,
  PICKER_RESULTS,
} from '~/components/screen/screen'

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
  <div class="flex flex-col gap-1.5">
    <Label :for="inputId">{{ label ?? t('ui.sites.picker.label') }}</Label>
    <Input
      :id="inputId"
      v-model="query"
      type="search"
      class="h-11 md:h-9"
      :placeholder="t('ui.sites.picker.placeholder')"
      autocomplete="off"
    />
    <ul
      v-if="results.length"
      :class="PICKER_RESULTS"
      role="listbox"
      :aria-label="t('ui.sites.picker.results')"
    >
      <li v-for="site in results" :key="site.id">
        <button type="button" :class="PICKER_OPTION" role="option" @click="emit('select', site)">
          {{ site.summary }}
          <StatusTag v-if="site.linked" tone="grey">{{ t('ui.sites.picker.linked') }}</StatusTag>
        </button>
      </li>
    </ul>
    <p v-else-if="status === 'failed'" :class="PICKER_ERROR">
      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
      {{ t('ui.sites.picker.failed') }}
    </p>
    <p v-else-if="query && status === 'done'" :class="PICKER_HINT">
      {{ t('ui.sites.picker.noMatches') }}
    </p>
  </div>
</template>
