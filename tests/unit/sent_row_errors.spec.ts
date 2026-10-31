import { test } from '@japa/runner'
import { nextTick, reactive, ref, type Ref } from 'vue'

// The helper is in the pages' TypeScript project, which the server's (these
// tests') doesn't build: loaded as the test runs, typed by its use here
type SentRowErrors = {
  error: (key: number, field: string) => string | undefined
  errorsOf: (key: number) => Record<string, string>
  invalid: (key: number, field: string) => 'true' | undefined
  send: () => void
  cancel: () => void
  clear: (key: number) => void
}
const { useSentRowErrors } = (await import(
  '../../inertia/components/screen/sent_row_errors.js' as string
)) as {
  useSentRowErrors: (options: {
    rows: () => { key: number }[]
    errors: Ref<Record<string, string>>
    name: string
    fields: string[]
  }) => SentRowErrors
}

/**
 * Rows edited in place keep the errors of the save the server refused
 * (#289): what happens to that order when a save gets no answer, and to
 * a row whose fields were replaced since (#292).
 */
function rowsWithErrors() {
  const rows = reactive([{ key: 1 }, { key: 2 }, { key: 3 }])
  const errors = ref<Record<string, string>>({})
  const sent = useSentRowErrors({
    rows: () => rows,
    errors,
    name: 'lines',
    fields: ['description'],
  })
  /** The server's answer to the save sent: its errors */
  const answer = async (answered: Record<string, string>) => {
    errors.value = answered
    await nextTick()
  }
  const shown = () => rows.map((row) => sent.error(row.key, 'description') ?? null)
  return { rows, errors, sent, answer, shown }
}

test.group('Errors of rows saved together', () => {
  test('each row keeps the errors of the save it was in, wherever it is now', async ({
    assert,
  }) => {
    const { rows, sent, answer, shown } = rowsWithErrors()
    sent.send()
    await answer({ 'lines.1.description': 'Obbligatorio' })
    assert.deepEqual(shown(), [null, 'Obbligatorio', null])

    rows.splice(0, 1)
    rows.push({ key: 4 })
    assert.deepEqual(shown(), ['Obbligatorio', null, null])
  })

  test('a save with no answer leaves no order behind for the next errors', async ({ assert }) => {
    const { rows, sent, answer, shown } = rowsWithErrors()
    sent.send()
    await answer({ 'lines.1.description': 'Obbligatorio' })

    // Sent with the first removed, then cancelled
    rows.splice(0, 1)
    sent.send()
    sent.cancel()
    assert.deepEqual(shown(), ['Obbligatorio', null])

    // New errors not from a save (another action's) keep the last save's order
    await answer({ 'lines.1.description': 'Troppo lungo' })
    assert.deepEqual(shown(), ['Troppo lungo', null])
  })

  test('a row cleared has no errors until the next answer', async ({ assert }) => {
    const { sent, answer, shown } = rowsWithErrors()
    sent.send()
    await answer({ 'lines.0.description': 'Obbligatorio', 'lines.1.description': 'Obbligatorio' })

    sent.clear(1)
    assert.deepEqual(shown(), [null, 'Obbligatorio', null])
    assert.deepEqual(sent.errorsOf(1), {})
    assert.isUndefined(sent.invalid(1, 'description'))

    sent.send()
    await answer({ 'lines.0.description': 'Obbligatorio' })
    assert.deepEqual(shown(), ['Obbligatorio', null, null])
  })
})
