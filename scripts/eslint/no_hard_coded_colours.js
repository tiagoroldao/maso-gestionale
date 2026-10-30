/**
 * Colours on the new UI come from the tokens in `inertia/css/main.css`
 * (docs/ui.md "Look"), light and dark. This rule flags a hard-coded colour
 * in a `.vue` file: a hex value, a colour function (rgb, hsl, oklch…) or a
 * Tailwind arbitrary colour (`bg-[#fff]`, `text-[color:…]`, `bg-(--x)`),
 * in the template (static and bound attributes, expressions) and in the
 * script's strings (class lists built in `cn(...)`, style objects).
 * Comments are not checked, so issue references (#123) stay allowed.
 */

const HEX = /(?<![\da-z&#])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\w-])/i
const COLOUR_FUNCTION = /(?<![a-z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i
// `text-[color:var(--x)]`, and utilities that only ever take a colour,
// pointed at a variable rather than a token: `bg-[var(--x)]`, `fill-(--x)`
const ARBITRARY_COLOUR =
  /-[[(]color:|\b(?:bg|fill|stroke|accent|caret|decoration)-(?:\[var\(|\(--)/i

function findColour(text) {
  for (const pattern of [HEX, COLOUR_FUNCTION, ARBITRARY_COLOUR]) {
    const match = pattern.exec(text)
    if (match) return match[0]
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
    function check(node, text) {
      if (typeof text !== 'string') return
      const found = findColour(text)
      if (found) context.report({ node, messageId: 'hardCoded', data: { found } })
    }

    const visitor = {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked),
    }
    const templateVisitor = {
      ...visitor,
      // Static attributes: class="…", style="…", fill="…"
      VAttribute: (node) => {
        if (!node.directive) check(node, node.value?.value)
      },
    }

    const services = context.sourceCode.parserServices
    if (!services?.defineTemplateBodyVisitor) return visitor
    return services.defineTemplateBodyVisitor(templateVisitor, visitor)
  },
}

export default {
  rules: { 'no-hard-coded-colours': rule },
}
