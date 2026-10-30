<script setup lang="ts">
/**
 * The question before a destructive or irreversible action (docs/ui.md
 * "Actions"): nothing else is confirmed. Its title is the action, its
 * text says what follows; "confirm" fires on the action's own button.
 */
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import { buttonVariants } from '~/components/ui/button'
import { DIALOG_CONTENT, DIALOG_OVERLAY, DialogFooter } from '~/components/ui/dialog'

defineProps<{ title: string; description: string; confirmLabel: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [] }>()

/** Roomy on touch screens, compact from 768px */
const button = (variant: 'default' | 'outline') =>
  cn(buttonVariants({ variant, size: 'touch' }), 'md:h-9')
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay :class="DIALOG_OVERLAY" />
      <AlertDialogContent :class="DIALOG_CONTENT">
        <AlertDialogTitle class="m-0 text-lg font-semibold text-foreground">
          {{ title }}
        </AlertDialogTitle>
        <AlertDialogDescription class="m-0 text-sm whitespace-pre-line text-foreground-2">
          {{ description }}
        </AlertDialogDescription>
        <DialogFooter>
          <AlertDialogCancel :class="button('outline')">
            {{ t('ui.screen.goBack') }}
          </AlertDialogCancel>
          <AlertDialogAction :class="button('default')" @click="emit('confirm')">
            {{ confirmLabel }}
          </AlertDialogAction>
        </DialogFooter>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
