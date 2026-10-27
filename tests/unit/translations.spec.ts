import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { ROLES } from '#models/user'
import { CUSTOMER_TYPES } from '#models/customer'

async function catalogue() {
  const directory = app.makePath('resources/lang/it')
  const keys = new Set<string>()
  const collect = (prefix: string, value: unknown) => {
    if (typeof value === 'string') keys.add(prefix)
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) collect(`${prefix}.${key}`, child)
    }
  }
  for (const file of await readdir(directory)) {
    collect(file.replace(/\.json$/, ''), JSON.parse(await readFile(join(directory, file), 'utf8')))
  }
  return keys
}

async function frontendSources(directory = app.makePath('inertia')): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return frontendSources(path)
      return /\.(vue|ts)$/.test(entry.name) ? [path] : []
    })
  )
  return files.flat()
}

test.group('Translations', () => {
  test('every key used in the Vue pages exists in the catalogue', async ({ assert }) => {
    const keys = await catalogue()
    const missing: string[] = []

    for (const file of await frontendSources()) {
      const source = await readFile(file, 'utf8')
      for (const [, key] of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!keys.has(key)) missing.push(`${key} (${file})`)
      }
    }

    assert.deepEqual(missing, [])
  })

  test('keys built at runtime exist for every value', async ({ assert }) => {
    const keys = await catalogue()
    const dynamic = [
      ...ROLES.map((role) => `ui.roles.${role}`),
      ...CUSTOMER_TYPES.map((type) => `ui.customers.types.${type}`),
      ...[
        'boiler',
        'waterHeater',
        'airConditioner',
        'heatPump',
        'solarThermal',
        'waterSoftener',
        'pressurePump',
      ].map((key) => `ui.equipment.commonTypes.${key}`),
    ]

    assert.deepEqual(
      dynamic.filter((key) => !keys.has(key)),
      []
    )
  })
})
