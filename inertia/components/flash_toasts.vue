<script setup lang="ts">
import { watch } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { toast, Toaster } from 'vue-sonner'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-vue-next'

const page = usePage()

watch(
  () => page.url,
  () => toast.dismiss()
)

watch(
  () => page.flash,
  (flash) => {
    if (flash.error) toast.error(flash.error, { id: 'flash' })
    if (flash.success) toast.success(flash.success, { id: 'flash' })
    if (flash.warning) toast.warning(flash.warning, { id: 'flash' })
  },
  { immediate: true }
)
</script>

<template>
  <Toaster position="top-center" :toast-options="{ unstyled: true }">
    <template #success-icon>
      <CircleCheck :size="18" :stroke-width="1.8" />
    </template>
    <template #error-icon>
      <CircleAlert :size="18" :stroke-width="1.8" />
    </template>
    <template #warning-icon>
      <TriangleAlert :size="18" :stroke-width="1.8" />
    </template>
  </Toaster>
</template>
