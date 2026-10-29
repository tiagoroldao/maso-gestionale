import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { OpenapiSdiGateway } from '#services/openapi_sdi_gateway'

/**
 * Against Openapi's real sandbox, only when OPENAPI_SANDBOX_TOKEN is set in
 * the environment (never in CI, never committed). Read-only: it lists
 * what the sandbox account holds, checking the token, the address and the
 * shape of the answers the recorded fake imitates.
 */
const token = process.env.OPENAPI_SANDBOX_TOKEN

test.group('Openapi sandbox (live)', () => {
  test('lists received and sent files with the token', async ({ assert }) => {
    const gateway = new OpenapiSdiGateway({ token: token!, environment: 'sandbox' })
    const since = DateTime.now().minus({ days: 30 })

    const received = await gateway.received(since)
    for (const ref of received) {
      assert.isString(ref.remoteId)
      assert.isTrue(ref.receivedAt.isValid)
    }
    const sent = await gateway.findSent({ number: '0/0000', issuedOn: '2000-01-01' })
    assert.isArray(sent)
  })
    .skip(!token, 'OPENAPI_SANDBOX_TOKEN is not set')
    .timeout(60_000)
})
