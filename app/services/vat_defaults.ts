import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Customer from '#models/customer'
import type Job from '#models/job'
import Site from '#models/site'
import VatCode from '#models/vat_code'
import VatRule from '#models/vat_rule'
import { LINE_KINDS, type LineKind } from '#shared/vat'

export type JobVatDefaults = Record<LineKind, VatCode>

/**
 * The one place that decides a new line's VAT Code (ADR 0008): a Job's
 * lines follow the Admin's default rules, other lines the Item's own code;
 * the standard rate fills any gap. Office can still change any line's code.
 */
export default class VatDefaults {
  /**
   * The standard rate: the highest active rate without a Natura code,
   * ties broken by name.
   */
  static standard(client?: TransactionClientContract) {
    return VatCode.query({ client })
      .withScopes((scopes) => scopes.active())
      .whereNull('natura')
      .orderBy([
        { column: 'rate', order: 'desc' },
        { column: 'name', order: 'asc' },
      ])
      .firstOrFail()
  }

  /**
   * The code for each kind of line on the Job's Invoices and Quote, from
   * its Customer's type, its Work Category and its Site. A rule pointing
   * at a code archived since gives the standard rate.
   */
  static async forJob(
    job: Pick<Job, 'customerId' | 'siteId' | 'workCategory'>,
    client?: TransactionClientContract
  ): Promise<JobVatDefaults> {
    const customer = await Customer.findOrFail(job.customerId, { client })
    const site = job.siteId ? await Site.find(job.siteId, { client }) : null
    const rules = await VatRule.query({ client })
      .where('customerType', customer.type)
      .where('workCategory', job.workCategory)
      .where('residential', site?.residential ?? false)
      .preload('vatCode')
    const standard = await this.standard(client)
    const codeFor = (kind: LineKind) => {
      const code = rules.find((rule) => rule.lineKind === kind)?.vatCode
      return code && !code.archivedAt ? code : standard
    }
    return Object.fromEntries(LINE_KINDS.map((kind) => [kind, codeFor(kind)])) as JobVatDefaults
  }

  /**
   * The same, as code ids for the Quote and Invoice pages.
   */
  static async idsForJob(job: Pick<Job, 'customerId' | 'siteId' | 'workCategory'>) {
    const defaults = await this.forJob(job)
    return Object.fromEntries(LINE_KINDS.map((kind) => [kind, defaults[kind].id])) as Record<
      LineKind,
      number
    >
  }
}
