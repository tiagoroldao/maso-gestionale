import { test } from '@japa/runner'
import {
  isValidTemplateBody,
  placeholderKeys,
  renderTemplateBody,
  type TemplateNode,
} from '#shared/document_templates'

const body: TemplateNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Dichiarazione' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Il cliente ' },
        { type: 'placeholder', attrs: { key: 'recipient.name' } },
        { type: 'text', text: ' dichiara', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'placeholder', attrs: { key: 'field.model' } },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Uno' }] }],
        },
      ],
    },
  ],
}

test.group('Document Template bodies', () => {
  test('renders allowed nodes, marks and placeholders', ({ assert }) => {
    const html = renderTemplateBody(body, { 'recipient.name': 'Mario Rossi', 'field.model': 'X1' })
    assert.equal(
      html,
      '<h1>Dichiarazione</h1><p>Il cliente Mario Rossi<strong> dichiara</strong><br>X1</p><ul><li><p>Uno</p></li></ul>'
    )
  })

  test('escapes text and values, so no markup gets through', ({ assert }) => {
    const doc: TemplateNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<script>alert(1)</script>' },
            { type: 'placeholder', attrs: { key: 'recipient.name' } },
          ],
        },
      ],
    }
    const html = renderTemplateBody(doc, { 'recipient.name': '<img src=x onerror=alert(1)>' })
    assert.notInclude(html, '<script')
    assert.notInclude(html, '<img')
    assert.include(html, '&lt;script&gt;')
  })

  test('accepts only allowed nodes, marks and known placeholders', ({ assert }) => {
    const keys = placeholderKeys([{ key: 'model' }])
    assert.isTrue(isValidTemplateBody(body, keys))
    assert.isFalse(isValidTemplateBody(body, placeholderKeys([])))
    assert.isFalse(
      isValidTemplateBody({ type: 'doc', content: [{ type: 'codeBlock', content: [] }] }, keys)
    )
    assert.isFalse(
      isValidTemplateBody(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'x', marks: [{ type: 'link' }] }],
            },
          ],
        },
        keys
      )
    )
    assert.isFalse(isValidTemplateBody({ type: 'paragraph' }, keys))
    assert.isFalse(isValidTemplateBody('<p>html</p>', keys))
    assert.isFalse(
      isValidTemplateBody(
        { type: 'doc', content: [{ type: 'heading', attrs: { level: 6 }, content: [] }] },
        keys
      )
    )
  })
})
