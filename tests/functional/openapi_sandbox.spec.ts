import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { OpenapiSdiGateway } from '#services/openapi_sdi_gateway'
import env from '#start/env'

/**
 * Against Openapi's real sandbox, only when asked with
 * OPENAPI_SANDBOX_LIVE=1 (never in CI), with OPENAPI_SANDBOX_TOKEN from
 * .env or the environment: a token in .env alone doesn't run it. Read-only:
 * it lists what the sandbox account holds, checking the token, the address
 * and the shape of the answers the recorded fake imitates.
 */
const live = process.env.OPENAPI_SANDBOX_LIVE === '1'
const token = env.get('OPENAPI_SANDBOX_TOKEN')

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
    .skip(
      !live || !token,
      live ? 'OPENAPI_SANDBOX_TOKEN is not set' : 'Live only with OPENAPI_SANDBOX_LIVE=1'
    )
    .timeout(60_000)
})
