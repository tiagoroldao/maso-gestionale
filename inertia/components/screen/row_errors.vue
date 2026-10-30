<script setup lang="ts">
/**
 * The errors of a row edited in place (#226): they show after the row's
 * inputs, away from them, so each names its field ("Nome: …"), in red with
 * an icon and words (docs/ui.md "Look").
 */
import { CircleAlert } from 'lucide-vue-next'
import { t } from '~/i18n'

defineProps<{
  errors: Partial<Record<string, string>>
  /** The row's fields, by input name, with the label each error names */
  fields: Record<string, string>
}>()
</script>

<template>
  <template v-for="(label, field) in fields" :key="field">
    <p v-if="errors[field]" class="m-0 flex w-full items-start gap-1.5 text-sm text-destructive">
      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
      {{ t('ui.common.fieldError', { field: label, message: errors[field] }) }}
    </p>
  </template>
</template>
