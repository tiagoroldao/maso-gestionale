<script setup lang="ts">
/**
 * An Item's preview (#236), opened from a Charge without leaving the
 * record it is on: set `itemId` to open it, and it loads the Item from
 * its preview endpoint; closing sets it back to null.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { formatQuantity as quantity } from '@shared/stock'
import { t } from '~/i18n'
import { urlFor } from '~/client'
import RecordPreview, { type PreviewFact } from '~/components/screen/record_preview.vue'

type PreviewedItem = {
  id: number
  code: string
  description: string
  unit: string
  category: string | null
  inStock: string
  available: string
}

const itemId = defineModel<number | null>('itemId', { required: true })

const item = ref<PreviewedItem | null>(null)
// Kept while the preview closes, so "Apri scheda" stays a real link
const shownId = ref(itemId.value ?? 0)
const state = ref<'loading' | 'ready' | 'failed'>('loading')
let controller: AbortController | undefined

async function load(id: number) {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller
  shownId.value = id
  item.value = null
  state.value = 'loading'
  try {
    const response = await fetch(urlFor('items.preview', { id }), {
      headers: { accept: 'application/json' },
      signal,
    })
    if (!response.ok) throw new Error(`Item preview failed with ${response.status}`)
    const body = (await response.json()) as { item: PreviewedItem }
    if (signal.aborted) return
    item.value = body.item
    state.value = 'ready'
  } catch {
    if (signal.aborted) return
    state.value = 'failed'
  }
}

watch(itemId, (id) => (id === null ? controller?.abort() : load(id)), { immediate: true })
onBeforeUnmount(() => controller?.abort())

const open = computed({
  get: () => itemId.value !== null,
  set: (value) => {
    if (!value) itemId.value = null
  },
})
const facts = computed<PreviewFact[]>(() => {
  if (!item.value) return []
  const { unit, inStock, available } = item.value
  return [
    { label: t('ui.items.stock'), value: `${quantity(inStock)} ${unit}` },
    { label: t('ui.items.available'), value: `${quantity(available)} ${unit}` },
  ]
})
</script>

<template>
  <RecordPreview
    v-model:open="open"
    :kind="t('ui.items.itemSection')"
    :title="item?.description"
    :subtitle="item ? [item.code, item.category].filter(Boolean).join(' · ') : undefined"
    :href="urlFor('items.show', { id: shownId })"
    :state="state"
    :facts="facts"
  />
</template>
