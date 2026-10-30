/**
 * Colours on the new UI come from the tokens in `inertia/css/main.css`
 * (docs/ui.md "Look"), light and dark. This rule flags a hard-coded colour
 * in a `.vue` file: a hex value, a colour function (rgb, hsl, oklch…) or a
 * Tailwind arbitrary colour (`bg-[#fff]`, `text-[color:…]`,
 * `border-[var(--x)]`, `ring-(--x)`), in the template's attributes and
 * expressions, the script's strings (class lists built in `cn(...)`, style
 * objects) and `<style>` blocks. Comments are not checked, and a `#` only
 * reads as a hex colour where a colour would stand, so issue references
 * ("see #123") and anchors (`href="#add"`) pass. A variable that holds a
 * length takes a type hint: `border-[length:var(--w)]`.
 */

// A hex colour: the whole string, or after `[ ( , : _` or a space following `:`
const HEX = /(?:^\s*|[[(,:_]\s*)(#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4}))(?![\w-])/i
const COLOUR_FUNCTION = /(?<![a-z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i
// `text-[color:…]`, and colour utilities pointed at a variable rather than a token
const ARBITRARY_COLOUR =
  /-[[(]color:|(?<![\w-])(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|inset-ring|outline|shadow|inset-shadow|divide|placeholder|from|via|to|fill|stroke|accent|caret|decoration)-(?:\[var\(|\(--)/i
// Attributes that never hold a colour
const NOT_COLOUR_ATTRIBUTES = new Set(['href', 'id', 'for', 'name', 'src', 'action', 'to'])

/** The first hard-coded colour in `text`: what it reads and where */
function findColour(text) {
  const hex = HEX.exec(text)
  if (hex) return { found: hex[1], index: hex.index + hex[0].indexOf(hex[1]) }
  for (const pattern of [COLOUR_FUNCTION, ARBITRARY_COLOUR]) {
    const match = pattern.exec(text)
    if (match) return { found: match[0], index: match.index }
  }
  return undefined
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

    function check(node, text) {
      if (typeof text !== 'string') return
      const colour = findColour(text)
      if (colour) context.report({ node, messageId: 'hardCoded', data: { found: colour.found } })
    }

    /** `<style>` blocks aren't parsed by ESLint: read them from the source (first colour per block) */
    function checkStyleBlocks() {
      for (const block of sourceCode.text.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/gi)) {
        const css = block[2].replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length))
        const colour = findColour(css)
        if (!colour) continue
        context.report({
          loc: sourceCode.getLocFromIndex(block.index + block[1].length + colour.index),
          messageId: 'hardCoded',
          data: { found: colour.found },
        })
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
        check(node, node.value?.value)
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
