import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import QuoteLine from '#models/quote_line'
import type Quote from '#models/quote'
import type { ScreenAction } from '#shared/screen_actions'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { createQuote } from '#tests/helpers/quotes'
import { vatCode } from '#tests/helpers/items'
import { it } from '#tests/helpers/i18n'

/** The Quote screen's props, as the role sees them */
async function screenOf(client: ApiClient, path: string, role: 'office' | 'admin' = 'office') {
  const page = await client
    .get(path)
    .withInertia()
    .loginAs(await createUser(role))
  page.assertStatus(200)
  return page.inertiaProps as { actions: ScreenAction[]; previewItems: boolean }
}
const ranked = (actions: ScreenAction[]) => actions.map((action) => `${action.name}:${action.rank}`)

/** A Quote with one priced line, so it can be sent and decided */
async function pricedQuote(attributes: Partial<Quote> = {}) {
  const job = await createJob(await createCustomer())
  const quote = await createQuote(job, attributes)
  const vat = await vatCode()
  await QuoteLine.create({
    quoteId: quote.id,
    position: 1,
    kind: 'call_out',
    description: 'Diritto di chiamata',
    quantity: '1',
    unitPrice: '50',
    lineTotal: '50.00',
    vatCodeId: vat.id,
    vatRate: vat.rate,
  })
  return { job, quote }
}

test.group('Quote screen actions (#240)', () => {
  test('a new Quote: Save is all there is, for Office and the Admin', async ({
    client,
    assert,
  }) => {
    const job = await createJob(await createCustomer())
    for (const role of ['office', 'admin'] as const) {
      const props = await screenOf(client, `/jobs/${job.id}/quotes/create`, role)
      assert.deepEqual(ranked(props.actions), ['save:primary'])
      assert.isTrue(props.previewItems)
    }
  })

  test('a draft: Save first, sending and the PDF beside it, the answer in "⋯", each asked first', async ({
    client,
    assert,
  }) => {
    const { job, quote } = await pricedQuote()
    const { actions } = await screenOf(client, `/quotes/${quote.id}`)

    assert.deepEqual(ranked(actions), [
      'save:primary',
      'send:secondary',
      'pdf:secondary',
      'accept:overflow',
      'decline:overflow',
    ])
    const send = actions.find((action) => action.name === 'send')!
    assert.equal(send.href, `/quotes/${quote.id}/send`)
    assert.equal(send.confirm, it('ui.quotes.sendConfirm'))
    const decline = actions.find((action) => action.name === 'decline')!
    assert.equal(decline.confirm, it('ui.quotes.declineConfirm', { number: `${job.number}-1` }))
    assert.isNotNull(actions.find((action) => action.name === 'accept')!.confirm)
  })

  test('a draft with nothing priced can be saved, not sent nor decided', async ({
    client,
    assert,
  }) => {
    const quote = await createQuote(await createJob(await createCustomer()))
    const { actions } = await screenOf(client, `/quotes/${quote.id}`)
    assert.deepEqual(ranked(actions), ['save:primary', 'pdf:secondary'])
  })

  test('a sent Quote: the acceptance is the primary, declining in "⋯"', async ({
    client,
    assert,
  }) => {
    const { quote } = await pricedQuote({ status: 'sent' })
    const { actions } = await screenOf(client, `/quotes/${quote.id}`)
    assert.deepEqual(ranked(actions), ['pdf:secondary', 'accept:primary', 'decline:overflow'])
  })

  test('a decided Quote, or one on a cancelled Job, only has its PDF', async ({
    client,
    assert,
  }) => {
    const { quote: accepted } = await pricedQuote({ status: 'accepted' })
    const decided = await screenOf(client, `/quotes/${accepted.id}`)
    assert.deepEqual(ranked(decided.actions), ['pdf:secondary'])

    const { job, quote: sent } = await pricedQuote({ status: 'sent' })
    job.status = 'cancelled'
    await job.save()
    const frozen = await screenOf(client, `/quotes/${sent.id}`)
    assert.deepEqual(ranked(frozen.actions), ['pdf:secondary'])
  })
})
