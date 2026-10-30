import { test } from '@japa/runner'
import { urlFor } from '@adonisjs/core/services/url_builder'
import { ROLES } from '#models/user'
import { menuFor } from '#shared/menu'
import { createUser } from '#tests/helpers/users'

test.group('App menu', () => {
  for (const role of ROLES) {
    test(`every item in the ${role}'s menu opens for them`, async ({ client, assert }) => {
      const user = await createUser(role)
      const items = menuFor(role).flatMap((group) => group.items)
      assert.isNotEmpty(items)

      for (const item of items) {
        const url = urlFor(item.route as Parameters<typeof urlFor>[0])
        const response = await client.get(url).withInertia().loginAs(user)
        assert.equal(response.status(), 200, `${item.label} (${url})`)
      }
    })
  }

  test('a Technician sees only their Visits', ({ assert }) => {
    assert.deepEqual(
      menuFor('technician').map((group) => group.items.map((item) => item.label)),
      [['ui.nav.myVisits']]
    )
  })

  test('Office sees no settings, users or instance', ({ assert }) => {
    const routes = menuFor('office').flatMap((group) => group.items.map((item) => item.route))
    assert.notIncludeMembers(routes, ['company_settings.edit', 'users.index', 'instance'])
    assert.notInclude(
      menuFor('office').map((group) => group.label),
      'ui.nav.groups.settings'
    )
  })
})
