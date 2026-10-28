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
    const keys = placeholderKeys([{ key: 'model', type: 'text' }])
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

  test('entity fields have property placeholders; table fields have none', ({ assert }) => {
    assert.deepEqual(
      placeholderKeys([
        { key: 'site', type: 'site' },
        { key: 'boiler', type: 'equipment' },
        { key: 'job', type: 'job' },
        { key: 'part', type: 'item' },
        { key: 'parts', type: 'items' },
        { key: 'rows', type: 'table' },
      ]),
      [
        'company.name',
        'recipient.name',
        'today',
        'field.site',
        'field.site.address',
        'field.site.city',
        'field.boiler',
        'field.boiler.make',
        'field.boiler.model',
        'field.boiler.serial_number',
        'field.boiler.installed_on',
        'field.job',
        'field.job.number',
        'field.job.title',
        'field.part',
        'field.part.code',
        'field.part.description',
        'field.parts',
      ]
    )
  })

  test('renders a table field with escaped headers and cells', ({ assert }) => {
    const doc: TemplateNode = {
      type: 'doc',
      content: [
        { type: 'fieldTable', attrs: { key: 'rows', label: 'Righe' } },
        { type: 'fieldTable', attrs: { key: 'missing' } },
      ],
    }
    assert.isTrue(isValidTemplateBody(doc, [], ['rows', 'missing']))
    assert.isFalse(isValidTemplateBody(doc, [], ['rows']))

    const html = renderTemplateBody(
      doc,
      {},
      {
        rows: {
          headers: ['<b>Codice</b>', 'Qtà'],
          rows: [
            ['<script>', '2'],
            ['A&B', ''],
          ],
        },
      }
    )
    assert.equal(
      html,
      '<table class="field-table"><thead><tr><th>&lt;b&gt;Codice&lt;/b&gt;</th><th>Qtà</th></tr></thead>' +
        '<tbody><tr><td>&lt;script&gt;</td><td>2</td></tr><tr><td>A&amp;B</td><td></td></tr></tbody></table>'
    )
  })

  test('refuses unknown attributes, properties and nesting', ({ assert }) => {
    const keys = placeholderKeys([])
    const p = (node: object) => ({ type: 'doc', content: [node] })
    const refused = [
      // Attributes a node doesn't have
      p({ type: 'paragraph', attrs: { onclick: 'x', style: 'color:red' } }),
      // Names inherited from Object.prototype are not allowed attributes or types
      p({ type: 'paragraph', attrs: { constructor: ['img', { onerror: 'x' }], toString: 'x' } }),
      p({ type: 'constructor' }),
      // A heading without its level
      p({ type: 'heading', attrs: {} }),
      // Properties a node doesn't have
      { type: 'doc', content: [], evil: true },
      // A text node with children, a hard break with children
      p({ type: 'paragraph', content: [{ type: 'text', text: 'x', content: [] }] }),
      p({ type: 'paragraph', content: [{ type: 'hardBreak', content: [] }] }),
      // Nesting: a list item outside a list, inline at the top, a block inside a paragraph
      p({ type: 'listItem', content: [] }),
      { type: 'doc', content: [{ type: 'text', text: 'x' }] },
      p({ type: 'paragraph', content: [{ type: 'paragraph' }] }),
      // A placeholder label that isn't text
      p({
        type: 'paragraph',
        content: [
          { type: 'placeholder', attrs: { key: 'today', label: ['img', { onerror: 'x' }] } },
        ],
      }),
      // A mark with attributes
      p({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'bold', attrs: { href: 'x' } }] }],
      }),
    ]
    for (const doc of refused) assert.isFalse(isValidTemplateBody(doc, keys), JSON.stringify(doc))

    // What the editor produces is accepted
    assert.isTrue(
      isValidTemplateBody(
        {
          type: 'doc',
          content: [
            {
              type: 'orderedList',
              attrs: { start: 1, type: null },
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        { type: 'placeholder', attrs: { key: 'today', label: 'Data di oggi' } },
                      ],
                    },
                  ],
                },
              ],
            },
            { type: 'paragraph' },
            { type: 'horizontalRule' },
          ],
        },
        keys
      )
    )
  })
})
