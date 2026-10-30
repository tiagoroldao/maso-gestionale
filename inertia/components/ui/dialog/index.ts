export { default as Dialog } from './Dialog.vue'
export { default as DialogContent } from './DialogContent.vue'
export { default as DialogDescription } from './DialogDescription.vue'
export { default as DialogFooter } from './DialogFooter.vue'
export { default as DialogTitle } from './DialogTitle.vue'

/**
 * The dialog's frame, shared with the confirmation dialog (docs/ui.md
 * "Hierarchy and references": dialogs only for short, focused tasks).
 * It floats, so it has a shadow; full width less a gutter on the phone.
 */
export const DIALOG_OVERLAY =
  'fixed inset-0 z-50 bg-black/55 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0'
export const DIALOG_CONTENT =
  'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-sm border border-border bg-card p-5 font-sans text-card-foreground shadow-float data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0'
