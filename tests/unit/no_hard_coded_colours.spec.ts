import { test } from '@japa/runner'
import { ESLint } from 'eslint'

const RULE = 'local/no-hard-coded-colours'

/** What the repo's ESLint config reports for this rule on a `.vue` file: the colours it names, in order */
async function coloursIn(sfc: string) {
  const eslint = new ESLint()
  const [result] = await eslint.lintText(sfc, { filePath: 'inertia/pages/colour_rule_probe.vue' })
  return result.messages
    .filter((message) => message.ruleId === RULE)
    .map((message) => /"(.+?)"/.exec(message.message)?.[1])
}

const script = (body: string) => `<script setup lang="ts">\n${body}\n</script>\n`

test.group('Lint: no hard-coded colours (#252)', () => {
  test('flags hex in CSS shorthands in script strings', async ({ assert }) => {
    assert.deepEqual(
      await coloursIn(
        script(
          [
            "export const border = { border: '1px solid #ccc' }",
            "export const shadow = { boxShadow: '0 0 4px #000' }",
            "export const colour = { color: '#c0392b' }",
            "export const classes = 'bg-[#fff] shadow-[0_0_1px_rgba(0,0,0,0.3)] border-[var(--x)] md:ring-(--brand)'",
          ].join('\n')
        )
      ),
      ['#ccc', '#000', '#c0392b', '#fff']
    )
  })

  test('flags any hex in a style attribute and in each rule of a style block', async ({
    assert,
  }) => {
    assert.deepEqual(
      await coloursIn(
        [
          '<template><p style="border: 1px solid #abc" /></template>',
          '<style>',
          '/* #fff in a comment */',
          '.a { border: 1px solid #ddd }',
          '.b { color: rgb(0 0 0) }',
          '</style>',
        ].join('\n')
      ),
      ['#abc', '#ddd', 'rgb(']
    )
  })

  test('passes issue references, anchors, tokens and lengths', async ({ assert }) => {
    assert.deepEqual(
      await coloursIn(
        [
          script(
            "export const note = 'see #123'\nexport const classes = 'bg-card text-[10px] border-[length:var(--w)] shadow-drawer'"
          ),
          '<template><a href="#add" class="text-muted-foreground">{{ note }}</a></template>',
        ].join('\n')
      ),
      []
    )
  })
})
