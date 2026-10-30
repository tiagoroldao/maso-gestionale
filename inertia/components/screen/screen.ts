/**
 * What the Entity screen kit shares (docs/ui.md "Header", "Entity screen
 * body", "Look"): the label style, the shell's back button, and the
 * status tones of each kind of record.
 */
import type { InjectionKey, Ref } from 'vue'
import type { ChargeState, WorkState } from '@shared/charges'
import type { InvoiceStatus } from '@shared/invoice_lifecycle'
import type { JobIndicators, JobStatus } from '@shared/jobs'
import type { QuoteStatus } from '@shared/quotes'

/** Section labels and the breadcrumb: Montserrat in spaced capitals */
export const LABEL =
  'm-0 font-display text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase'

/** A link in running text or a row: the text's colour, underlined on hover */
export const LINK =
  'rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/** A section's table on desktop (docs/ui.md: on the phone it becomes a list of `ROW`s) */
export const TH =
  'border-b border-border px-4 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground'
export const TD = 'border-b border-border px-4 py-2.5 align-top text-sm'
export const ROW = 'flex items-start gap-2.5 border-t border-border px-3.5 py-3'

/**
 * A row edited in place (#226): its form (`EDIT_ROW_FORM`: the fields, Save
 * and the row's errors) then the row's other action, stacked on the phone,
 * in a line on desktop under the list's `RowHeads`.
 */
export const EDIT_ROW =
  'flex flex-col gap-2 border-t border-border px-3.5 py-3 md:flex-row md:items-start md:px-4'
export const EDIT_ROW_FORM =
  'flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:flex-wrap md:items-start'

/** A section's line when it has nothing to list */
export const EMPTY = 'm-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4'

/** A button or a field of a form: 44px on touch screens, compact from 768px */
export const TOUCH = 'h-11 md:h-9'

/** A place in the hierarchy: a breadcrumb's step, or where "‹" goes back to */
export type Crumb = { label: string; href: string }

/**
 * Where the phone's "‹" goes, set by the screen's header and shown by the
 * shell in place of the logo, beside "☰" (docs/ui.md "Header").
 */
export const SHELL_BACK: InjectionKey<Ref<Crumb | null>> = Symbol('shell-back')

/** Blue planned, orange in progress or to bill, green done or paid, grey draft or set aside */
export type Tone = 'blue' | 'orange' | 'green' | 'grey'

export const JOB_TONES: Record<JobStatus, Tone> = {
  open: 'blue',
  in_progress: 'orange',
  closed: 'green',
  cancelled: 'grey',
}

export const JOB_INDICATOR_TONES: Record<keyof JobIndicators, Tone> = {
  workComplete: 'green',
  invoiced: 'green',
  paid: 'green',
}

export const VISIT_TONES: Record<string, Tone> = {
  planned: 'blue',
  in_progress: 'orange',
  done: 'green',
  needs_return: 'orange',
  cancelled: 'grey',
}

export const CHARGE_TONES: Record<ChargeState, Tone> = {
  to_bill: 'orange',
  in_draft: 'grey',
  billed: 'green',
  not_billable: 'grey',
  credited: 'grey',
}

export const WORK_TONES: Record<WorkState, Tone> = {
  planned: 'blue',
  done: 'green',
  not_done: 'grey',
}

export const QUOTE_TONES: Record<QuoteStatus, Tone> = {
  draft: 'grey',
  sent: 'blue',
  accepted: 'green',
  declined: 'grey',
}

export const INVOICE_TONES: Record<InvoiceStatus, Tone> = {
  draft: 'grey',
  finalised: 'orange',
  submitted: 'blue',
  delivered: 'green',
  not_deliverable: 'orange',
  rejected: 'orange',
}
