<script setup lang="ts">
/**
 * A labelled input on the sign-in and setup forms, with its error (in red,
 * with an icon and words) tied to the input for screen readers.
 */
import { CircleAlert } from 'lucide-vue-next'

defineProps<{
  name: string
  label: string
  type: string
  autocomplete: string
  error?: string
}>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="name" class="text-sm font-medium">{{ label }}</label>
    <input
      :id="name"
      :name="name"
      :type="type"
      :autocomplete="autocomplete"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="error ? `${name}-error` : undefined"
      class="h-11 w-full rounded-sm border border-input bg-card px-3 text-base text-foreground outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring/40 aria-[invalid=true]:border-destructive"
    />
    <p v-if="error" :id="`${name}-error`" class="flex items-start gap-1.5 text-sm text-destructive">
      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
      {{ error }}
    </p>
  </div>
</template>
