/**
 * Which errors are a row's, among rows edited in place and saved together
 * (a Quote's or an Invoice's lines, an Invoice's sections, a Legacy
 * Invoice's VAT rows). The server names a row's errors by its position in
 * the save it refused (`lines.N.field`), so each row finds its own by the
 * position its key had in that save: they stay on their row when one is
 * removed, moved or added since (#287, #289, #292).
 *
 * A value, each step returning the next, so a page can hold it in its
 * reactive state (`inertia/components/screen/sent_row_errors.ts`).
 */
export type SentRows = {
  /** The rows' keys in the order the last answered save sent them */
  sent: number[]
  /** Those of the save in flight, until its answer */
  sending: number[] | null
  /** By row, the fields replaced since that save: their errors no longer apply */
  replaced: Record<number, string[]>
}

/** The rows as they are: no errors are theirs yet */
export function sentRows(keys: number[]): SentRows {
  return { sent: keys, sending: null, replaced: {} }
}

/** The rows are sent in this order: the answer refers to it */
export function sendRows(state: SentRows, keys: number[]): SentRows {
  return { ...state, sending: keys }
}

/**
 * The answer's errors have arrived: they refer to the order sent. New
 * errors with no save in flight (another action's) keep the last order.
 */
export function rowsAnswered(state: SentRows): SentRows {
  return state.sending ? { sent: state.sending, sending: null, replaced: {} } : state
}

/** The save got no answer (cancelled, or failed without one) */
export function sendCancelled(state: SentRows): SentRows {
  return { ...state, sending: null }
}

/** The row's fields were replaced (merged, folded): their errors no longer apply */
export function fieldsReplaced(state: SentRows, key: number, fields: string[]): SentRows {
  const replaced = [...new Set([...(state.replaced[key] ?? []), ...fields])]
  return { ...state, replaced: { ...state.replaced, [key]: replaced } }
}

/**
 * The name of the row's error on `field` (`lines.N.field`), or null when
 * the last answered save had no such row or the field was replaced since.
 */
export function rowErrorName(
  state: SentRows,
  name: string,
  key: number,
  field: string
): string | null {
  const position = state.sent.indexOf(key)
  if (position === -1 || state.replaced[key]?.includes(field)) return null
  return `${name}.${position}.${field}`
}
