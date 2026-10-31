import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'

/** The colour tokens of one block of inertia/css/main.css: `--color-name: #hex` */
function tokensOf(block: string) {
  const tokens = new Map<string, string>()
  for (const [, name, hex] of block.matchAll(/--color-([\w-]+):\s*(#[\da-f]{6});/gi)) {
    tokens.set(name, hex)
  }
  return tokens
}

/** WCAG 2 relative luminance of a #rrggbb colour */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * The theme's colours against WCAG (docs/ui.md "Look"): a field's boundary
 * reaches 3:1 against the surfaces it sits on, light and dark (1.4.11, #258).
 */
test.group('Colour tokens: contrast', () => {
  test("a field's border reaches 3:1 against the card and the background", async ({ assert }) => {
    const css = await readFile(app.makePath('inertia/css/main.css'), 'utf8')
    // Light in `@theme`, dark overriding some of them in `:root[data-theme='dark']`
    const darkStart = css.indexOf(":root[data-theme='dark']")
    const light = tokensOf(css.slice(css.indexOf('@theme {'), darkStart))
    const dark = new Map([...light, ...tokensOf(css.slice(darkStart))])

    for (const [theme, tokens] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      for (const surface of ['card', 'background']) {
        const ratio = contrast(tokens.get('input')!, tokens.get(surface)!)
        assert.isAtLeast(ratio, 3, `${theme}: input on ${surface} is ${ratio.toFixed(2)}:1`)
      }
    }
  })
})
