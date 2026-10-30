import { test } from '@japa/runner'
import {
  arrangeActions,
  declareActions,
  saveActions,
  ScreenActionsError,
  type ScreenActionInput,
} from '#shared/screen_actions'

const action = (name: string, rank: ScreenActionInput['rank'], extra = {}): ScreenActionInput => ({
  name,
  label: name,
  rank,
  kind: 'link',
  href: `/${name}`,
  ...extra,
})

test.group('Screen actions (docs/ui.md "Actions")', () => {
  test('a declaration fills in what an action leaves out', ({ assert }) => {
    assert.deepEqual(declareActions([action('edit', 'secondary')]), [
      {
        name: 'edit',
        label: 'edit',
        rank: 'secondary',
        kind: 'link',
        href: '/edit',
        destructive: false,
        confirm: null,
        disabledReason: null,
      },
    ])
  })

  test('a declaration breaking the rules is refused', ({ assert }) => {
    assert.throws(
      () => declareActions([action('a', 'primary'), action('b', 'primary')]),
      ScreenActionsError,
      'one primary action at most'
    )
    assert.throws(
      () => declareActions([action('a', 'secondary'), action('a', 'overflow')]),
      ScreenActionsError,
      'Two actions named a'
    )
    assert.throws(
      () => declareActions([action('cancel', 'secondary', { destructive: true, confirm: '?' })]),
      ScreenActionsError,
      'must be overflow and confirmed'
    )
    assert.throws(
      () => declareActions([action('cancel', 'overflow', { destructive: true })]),
      ScreenActionsError,
      'must be overflow and confirmed'
    )
    assert.throws(
      () => declareActions([action('go', 'overflow', { kind: 'post', href: null })]),
      ScreenActionsError,
      'needs an href'
    )
    assert.lengthOf(declareActions([action('draft', 'primary', { kind: 'dialog', href: null })]), 1)
    assert.lengthOf(declareActions([action('save', 'primary', { kind: 'submit', href: null })]), 1)
  })

  test('a screen in edit mode has Save as its primary, submitting its form', ({ assert }) => {
    assert.deepEqual(saveActions('Salva'), [
      {
        name: 'save',
        label: 'Salva',
        rank: 'primary',
        kind: 'submit',
        href: null,
        destructive: false,
        confirm: null,
        disabledReason: null,
      },
    ])
  })

  test('two secondary actions show as buttons, the rest go in "⋯"', ({ assert }) => {
    const arranged = arrangeActions(
      declareActions([
        action('more', 'overflow'),
        action('first', 'secondary'),
        action('main', 'primary'),
        action('second', 'secondary'),
        action('third', 'secondary'),
      ])
    )
    assert.equal(arranged.primary?.name, 'main')
    assert.deepEqual(
      arranged.secondary.map((found) => found.name),
      ['first', 'second']
    )
    assert.deepEqual(
      arranged.overflow.map((found) => found.name),
      ['third', 'more']
    )
    assert.isNull(arrangeActions([]).primary)
  })
})
