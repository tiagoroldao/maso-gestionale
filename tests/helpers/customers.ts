import Customer from '#models/customer'
import PaymentTerms from '#models/payment_terms'

/**
 * Form fields for a valid private-individual Customer.
 */
export function privateCustomerFields(overrides: Record<string, string> = {}) {
  return {
    type: 'private',
    firstName: 'Mario',
    lastName: 'Rossi',
    taxCode: 'RSSMRA85T10A562S',
    street: 'Via Garibaldi',
    streetNumber: '5',
    postalCode: '20121',
    city: 'Milano',
    province: 'MI',
    ...overrides,
  }
}

export async function defaultPaymentTerms() {
  return PaymentTerms.findByOrFail('name', 'Immediate')
}

export async function createCustomer(attributes: Partial<Customer> = {}) {
  const terms = await defaultPaymentTerms()
  return Customer.create({
    type: 'company',
    name: 'Idraulica Bianchi S.r.l.',
    vatNumber: '12345678903',
    street: 'Via Verdi',
    postalCode: '20121',
    city: 'Milano',
    province: 'MI',
    paymentTermsId: terms.id,
    ...attributes,
  })
}
