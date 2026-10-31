<script setup lang="ts">
/**
 * Searches Customers by name, Codice Fiscale or Partita IVA and emits the
 * chosen one.
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

export type PickedCustomer = { id: number; displayName: string; city: string }

defineProps<{ label?: string }>()
const emit = defineEmits<{ select: [customer: PickedCustomer] }>()

const inputId = useId()
const query = ref('')
const results = ref<PickedCustomer[]>([])
const status = ref<'idle' | 'loading' | 'done' | 'failed'>('idle')
let controller: AbortController | undefined
let timer: ReturnType<typeof setTimeout> | undefined

async function load() {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller

  try {
    const response = await fetch(
      `${urlFor('customers.search')}?${new URLSearchParams({ q: query.value })}`,
      { headers: { accept: 'application/json' }, signal }
    )
    if (!response.ok) throw new Error(`Customer search failed with ${response.status}`)
    const { customers } = (await response.json()) as { customers: PickedCustomer[] }
    if (signal.aborted) return
    results.value = customers
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

function choose(customer: PickedCustomer) {
  emit('select', customer)
  query.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="inputId">{{ label ?? t('ui.customers.picker.label') }}</Label>
    <Input
      :id="inputId"
      v-model="query"
      type="search"
      class="h-11 md:h-9"
      :placeholder="t('ui.customers.searchPlaceholder')"
      autocomplete="off"
    />
    <ul
      v-if="results.length"
      :class="PICKER_RESULTS"
      role="listbox"
      :aria-label="t('ui.customers.title')"
    >
      <li v-for="customer in results" :key="customer.id">
        <button type="button" :class="PICKER_OPTION" role="option" @click="choose(customer)">
          <span>{{ customer.displayName }}</span>
          <span class="text-[13px] text-muted-foreground">{{ customer.city }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="status === 'failed'" :class="PICKER_ERROR">
      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
      {{ t('ui.customers.picker.failed') }}
    </p>
    <p v-else-if="query && status === 'done'" :class="PICKER_HINT">
      {{ t('ui.customers.picker.noMatches') }}
    </p>
  </div>
</template>
