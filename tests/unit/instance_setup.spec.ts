import { test } from '@japa/runner'
import InstanceSetup, { SetupAlreadyCompletedError } from '#services/instance_setup'

const input = {
  superuser: { email: 'installer@example.com', password: 'installer-secret' },
  admin: { fullName: 'Mario Rossi', email: 'mario@example.com', password: 'admin-secret' },
}

test.group('InstanceSetup', () => {
  test('is incomplete until it has run', async ({ assert }) => {
    assert.isFalse(await InstanceSetup.isComplete())
    await InstanceSetup.run(input)
    assert.isTrue(await InstanceSetup.isComplete())
  })

  test('refuses to run twice', async ({ assert }) => {
    await InstanceSetup.run(input)
    await assert.rejects(() => InstanceSetup.run(input), SetupAlreadyCompletedError)
  })
})
