<script setup lang="ts">
/**
 * A labelled field of a short form (a dialog's): its control in the slot,
 * given the id, `aria-invalid` and `aria-describedby` to bind; under it a
 * hint, or the error in red with an icon and words (docs/ui.md "Look").
 */
import { computed } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import { Label } from '~/components/ui/label'

const props = defineProps<{ id: string; label: string; hint?: string; error?: string }>()

const describedBy = computed(() =>
  props.error ? `${props.id}-error` : props.hint ? `${props.id}-hint` : undefined
)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id">{{ label }}</Label>
    <slot :id="id" :invalid="error ? 'true' : 'false'" :described-by="describedBy" />
    <p
      v-if="error"
      :id="`${id}-error`"
      class="m-0 flex items-start gap-1.5 text-sm text-destructive"
    >
      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
      {{ error }}
    </p>
    <p v-else-if="hint" :id="`${id}-hint`" class="m-0 text-[13px] text-muted-foreground">
      {{ hint }}
    </p>
  </div>
</template>
