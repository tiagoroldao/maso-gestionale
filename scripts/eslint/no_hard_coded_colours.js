/**
 * Colours on the new UI come from the tokens in `inertia/css/main.css`
 * (docs/ui.md "Look"), light and dark. This rule flags a hard-coded colour
 * in a `.vue` file: a hex value, a colour function (rgb, hsl, oklch…) or a
 * Tailwind arbitrary colour (`bg-[#fff]`, `text-[color:…]`,
 * `border-[var(--x)]`, `ring-(--x)`), in the template's attributes and
 * expressions, the script's strings (class lists built in `cn(...)`, style
 * objects) and `<style>` blocks. Comments are not checked. In CSS (`<style>`
 * blocks, `style="…"`) any `#hex` is a colour; elsewhere a `#` reads as a
 * colour only where one would stand, so issue references ("see #123") and
 * anchors (`href="#add"`) pass. A variable that holds a length takes a type
 * hint: `border-[length:var(--w)]`. Tested in tests/unit/no_hard_coded_colours.spec.ts.
 */

const HEX_DIGITS = String.raw`#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\w-])`
// In CSS: any hex not inside a word or an HTML entity
const CSS_HEX = new RegExp(String.raw`(?<![\w&#])${HEX_DIGITS}`, 'gi')
// Elsewhere: the whole string; after `[ ( , : _`; or after a CSS value and a
// space, as in a shorthand (`1px solid #ccc`, `0 0 4px #000`)
const HEX = new RegExp(
  String.raw`(?:^\s*|[[(,:_]\s*|(?:\d(?:px|rem|em|%)?|solid|dashed|dotted|double|inset)\s+)(${HEX_DIGITS})`,
  'gi'
)
const COLOUR_FUNCTION = /(?<![a-z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi
// `text-[color:…]`, and colour utilities pointed at a variable rather than a token
const ARBITRARY_COLOUR =
  /-[[(]color:|(?<![\w-])(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|inset-ring|outline|shadow|inset-shadow|divide|placeholder|from|via|to|fill|stroke|accent|caret|decoration)-(?:\[var\(|\(--)/gi
// Attributes that never hold a colour
const NOT_COLOUR_ATTRIBUTES = new Set(['href', 'id', 'for', 'name', 'src', 'action', 'to'])

/** Every hard-coded colour in `text`, in order: what it reads and where */
function findColours(text, { css = false } = {}) {
  const found = []
  for (const match of text.matchAll(css ? CSS_HEX : HEX)) {
    const hex = css ? match[0] : match[1]
    found.push({ found: hex, index: match.index + match[0].lastIndexOf(hex) })
  }
  for (const pattern of [COLOUR_FUNCTION, ARBITRARY_COLOUR]) {
    for (const match of text.matchAll(pattern)) found.push({ found: match[0], index: match.index })
  }
  return found.sort((a, b) => a.index - b.index)
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Use the colour tokens, not hard-coded colours' },
    schema: [],
    messages: {
      hardCoded:
        'Hard-coded colour "{{ found }}": use a colour token from inertia/css/main.css (bg-card, text-muted-foreground, …).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode

    /** One report per string or attribute, for its first colour */
    function check(node, text, options) {
      if (typeof text !== 'string') return
      const [colour] = findColours(text, options)
      if (colour) context.report({ node, messageId: 'hardCoded', data: { found: colour.found } })
    }

    /** `<style>` blocks aren't parsed by ESLint: read them from the source, one report per colour */
    function checkStyleBlocks() {
      for (const block of sourceCode.text.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/gi)) {
        const css = block[2].replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length))
        for (const colour of findColours(css, { css: true })) {
          context.report({
            loc: sourceCode.getLocFromIndex(block.index + block[1].length + colour.index),
            messageId: 'hardCoded',
            data: { found: colour.found },
          })
        }
      }
    }

    const visitor = {
      Program: checkStyleBlocks,
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked),
    }
    const templateVisitor = {
      Literal: visitor.Literal,
      TemplateElement: visitor.TemplateElement,
      // Static attributes: class="…", style="…", fill="…"
      VAttribute: (node) => {
        if (node.directive || NOT_COLOUR_ATTRIBUTES.has(node.key.name)) return
        check(node, node.value?.value, { css: node.key.name === 'style' })
      },
    }

    const services = sourceCode.parserServices
    if (!services?.defineTemplateBodyVisitor) return visitor
    return services.defineTemplateBodyVisitor(templateVisitor, visitor)
  },
}

export default {
  rules: { 'no-hard-coded-colours': rule },
}
