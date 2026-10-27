import { CompanySettingSchema } from '#database/schema'

/**
 * The company's own details, edited live by the Admin and printed on
 * invoices and documents. There is exactly one row.
 */
export default class CompanySettings extends CompanySettingSchema {
  static table = 'company_settings'

  /**
   * The saved settings, or empty unsaved ones before the Admin first
   * fills them in.
   */
  static async current() {
    return (await this.find(1)) ?? new this().merge({ id: 1 })
  }
}
