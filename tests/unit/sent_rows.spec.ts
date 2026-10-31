import { test } from '@japa/runner'
import {
  fieldsReplaced,
  rowErrorName,
  rowsAnswered,
  sendCancelled,
  sendRows,
  sentRows,
  type SentRows,
} from '#shared/sent_rows'

/**
 * Rows edited in place keep the errors of the save the server refused
 * (#289): what happens to that order when a save gets no answer, and to
 * a row whose fields were replaced since (#292).
 */
const errorsOf = (state: SentRows, keys: number[], field = 'description') =>
  keys.map((key) => rowErrorName(state, 'lines', key, field))

test.group('Errors of rows saved together', () => {
  test('each row keeps the position it had in the save answered, wherever it is now', ({
    assert,
  }) => {
    let state = sentRows([1, 2, 3])
    state = rowsAnswered(sendRows(state, [1, 2, 3]))
    assert.deepEqual(errorsOf(state, [2, 3, 4]), [
      'lines.1.description',
      'lines.2.description',
      null,
    ])
  })

  test('while a save is in flight, the order stays that of the last answer', ({ assert }) => {
    const answered = rowsAnswered(sendRows(sentRows([1, 2, 3]), [1, 2, 3]))
    const inFlight = sendRows(answered, [2, 3])
    assert.deepEqual(errorsOf(inFlight, [2, 3]), ['lines.1.description', 'lines.2.description'])
    assert.deepEqual(errorsOf(rowsAnswered(inFlight), [2, 3]), [
      'lines.0.description',
      'lines.1.description',
    ])
  })

  test('a save with no answer leaves no order behind for the next errors', ({ assert }) => {
    const answered = rowsAnswered(sendRows(sentRows([1, 2, 3]), [1, 2, 3]))
    const cancelled = sendCancelled(sendRows(answered, [2, 3]))
    assert.isNull(cancelled.sending)
    // New errors not from a save (another action's) keep the last save's order
    assert.deepEqual(errorsOf(rowsAnswered(cancelled), [2, 3]), [
      'lines.1.description',
      'lines.2.description',
    ])
  })

  test("a row's replaced fields have no errors until the next answer; its others keep theirs", ({
    assert,
  }) => {
    const answered = rowsAnswered(sendRows(sentRows([1, 2]), [1, 2]))
    const merged = fieldsReplaced(answered, 1, ['quantity', 'unitPrice'])
    assert.isNull(rowErrorName(merged, 'lines', 1, 'quantity'))
    assert.isNull(rowErrorName(merged, 'lines', 1, 'unitPrice'))
    assert.equal(rowErrorName(merged, 'lines', 1, 'description'), 'lines.0.description')
    assert.equal(rowErrorName(merged, 'lines', 2, 'quantity'), 'lines.1.quantity')

    // The next answer is about the row as sent then: all its fields count
    const resent = rowsAnswered(sendRows(merged, [1, 2]))
    assert.equal(rowErrorName(resent, 'lines', 1, 'quantity'), 'lines.0.quantity')
    // Starting over from the server's rows forgets them too
    assert.deepEqual(sentRows([1, 2]).replaced, {})
  })
})
