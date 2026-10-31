<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { toast, Toaster } from 'vue-sonner'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-vue-next'

const page = usePage()

watch(
  () => page.url,
  () => toast.dismiss()
)

const show = (flash: typeof page.flash) => {
  if (flash.error) toast.error(flash.error, { id: 'flash' })
  if (flash.success) toast.success(flash.success, { id: 'flash' })
  if (flash.warning) toast.warning(flash.warning, { id: 'flash' })
}
watch(() => page.flash, show)
// The page's own flash once the Toaster listens: on a full page load (a
// plain form's refusal, #209) it isn't listening yet during setup
onMounted(() => show(page.flash))
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
