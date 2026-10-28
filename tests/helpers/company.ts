import CompanySettings from '#models/company_settings'

/**
 * Company settings complete enough to finalise Invoices.
 */
export async function completeCompany(attributes: Partial<CompanySettings> = {}) {
  const settings = await CompanySettings.current()
  settings.merge({
    name: 'Idraulica Maso S.r.l.',
    vatNumber: '01987654322',
    taxRegime: 'RF01',
    street: 'Via dei Mille',
    streetNumber: '12',
    postalCode: '20121',
    city: 'Milano',
    province: 'MI',
    iban: 'IT60X0542811101000000123456',
    ...attributes,
  })
  await settings.save()
  return settings
}
