import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Customer from '#models/customer'
import type Job from '#models/job'
import Site from '#models/site'
import VatCode from '#models/vat_code'
import VatRule from '#models/vat_rule'
import { LINE_KINDS, type LineKind } from '#shared/vat'

export type JobVatDefaults = Record<LineKind, VatCode>

/**
 * A Job's line has no VAT Code to start from: no default rule for it and
 * no standard rate, every active code having a Natura (#96).
 */
export class NoStandardVatCodeError extends Error {}

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
    return this.standardQuery(client).firstOrFail()
  }

  private static standardQuery(client?: TransactionClientContract) {
    return VatCode.query({ client })
      .withScopes((scopes) => scopes.active())
      .whereNull('natura')
      .orderBy([
        { column: 'rate', order: 'desc' },
        { column: 'name', order: 'asc' },
      ])
  }

  /**
   * The code for each kind of line on the Job's Invoices and Quotes, from
   * its Customer's type, its Work Category and its Site. A rule pointing
   * at a code archived since gives the standard rate; without one, a
   * kind no rule covers throws NoStandardVatCodeError.
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
    const standard = await this.standardQuery(client).first()
    const codeFor = (kind: LineKind) => {
      const code = rules.find((rule) => rule.lineKind === kind)?.vatCode
      if (code && !code.archivedAt) return code
      if (!standard) throw new NoStandardVatCodeError()
      return standard
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
