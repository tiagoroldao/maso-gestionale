/**
 * The errors of rows edited in place and saved together, each on its own
 * row wherever it has moved since (`shared/sent_rows.ts`): the rows' state
 * held for a page, taking the answer's order in with its errors.
 */
import { ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  fieldsReplaced,
  rowErrorName,
  rowsAnswered,
  sendCancelled,
  sendRows,
  sentRows,
} from '@shared/sent_rows'

export function useSentRowErrors(options: {
  /** The rows as on screen, each with a key of its own */
  rows: () => { key: number }[]
  /** The page's errors */
  errors: MaybeRefOrGetter<Record<string, string>>
  /** What the server names the rows by: `lines` for `lines.N.field` */
  name: string
  /** The rows' fields that can have errors */
  fields: string[]
}) {
  const keys = () => options.rows().map((row) => row.key)
  const state = ref(sentRows(keys()))

  // The answer's errors and the order they refer to arrive together: the
  // order changes only with them (before the screen updates), so the errors
  // on screen never move while a save is in flight
  watch(
    () => toValue(options.errors),
    () => {
      state.value = rowsAnswered(state.value)
    }
  )

  /** A row's error on `field`, if the last answered save had one */
  const error = (key: number, field: string): string | undefined => {
    const name = rowErrorName(state.value, options.name, key, field)
    return name === null ? undefined : toValue(options.errors)[name]
  }

  return {
    error,
    /** A row's errors, by field */
    errorsOf: (key: number) =>
      Object.fromEntries(
        options.fields.flatMap((field) => {
          const message = error(key, field)
          return message ? [[field, message]] : []
        })
      ) as Record<string, string>,
    /** `aria-invalid` for a row's field */
    invalid: (key: number, field: string) => (error(key, field) ? 'true' : undefined),
    /** Call as the rows are sent: their order now is the one the answer refers to */
    send: () => {
      state.value = sendRows(state.value, keys())
    },
    /** Call when the save sent gets no answer (cancelled, or failed without one) */
    cancel: () => {
      state.value = sendCancelled(state.value)
    },
    /** Call when a row's fields are replaced (merged into): their errors no longer apply */
    clear: (key: number, fields: string[]) => {
      state.value = fieldsReplaced(state.value, key, fields)
    },
    /** Call once the rows are again what the server has (after a save) */
    reset: () => {
      state.value = sentRows(keys())
    },
  }
}
