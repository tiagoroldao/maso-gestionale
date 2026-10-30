<script setup lang="ts">
/**
 * A labelled 44px input (Label and Input) on the sign-in and setup forms,
 * with its error (in red, with an icon and words) tied to the input for
 * screen readers.
 */
import { CircleAlert } from 'lucide-vue-next'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

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
    <Label :for="name">{{ label }}</Label>
    <Input
      :id="name"
      :name="name"
      :type="type"
      :autocomplete="autocomplete"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="error ? `${name}-error` : undefined"
      class="h-11"
    />
    <p v-if="error" :id="`${name}-error`" class="flex items-start gap-1.5 text-sm text-destructive">
      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
      {{ error }}
    </p>
  </div>
</template>
