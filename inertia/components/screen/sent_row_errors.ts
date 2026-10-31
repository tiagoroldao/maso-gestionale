/**
 * The errors of rows edited in place and saved together (a Quote's or an
 * Invoice's lines, an Invoice's sections, a Legacy Invoice's VAT rows). The
 * server names a row's errors by its position in the save it refused
 * (`lines.N.field`), so each row finds its own by the position its key had
 * in that save: they stay on their row when one is removed, moved or added
 * since (#287, #289, #292).
 */
import { ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

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
  // The rows' keys in the order the last answered save sent them; null
  // where a row's errors no longer apply (its fields replaced since)
  const sentKeys = ref<(number | null)[]>(keys())
  // Those of the save in flight, until its answer
  let sending: number[] | null = null

  // The answer's errors and the order they refer to arrive together: the
  // order changes only with them (before the screen updates), so the errors
  // on screen never move while a save is in flight
  watch(
    () => toValue(options.errors),
    () => {
      if (!sending) return
      sentKeys.value = sending
      sending = null
    }
  )

  /** A row's error on `field`, if the last answered save had one */
  const error = (key: number, field: string): string | undefined => {
    const sent = sentKeys.value.indexOf(key)
    return sent === -1 ? undefined : toValue(options.errors)[`${options.name}.${sent}.${field}`]
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
      sending = keys()
    },
    /**
     * Call when the save sent gets no answer (cancelled, or failed without
     * one): the errors on screen stay those of the last answered save.
     */
    cancel: () => {
      sending = null
    },
    /** Call when a row's fields are replaced (merged into): its errors no longer apply */
    clear: (key: number) => {
      sentKeys.value = sentKeys.value.map((sent) => (sent === key ? null : sent))
    },
    /** Call once the rows are again what the server has (after a save) */
    reset: () => {
      sending = null
      sentKeys.value = keys()
    },
  }
}
