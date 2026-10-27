import Site from '#models/site'

export function createSite(attributes: Partial<Site> = {}) {
  return Site.create({
    street: 'Via Roma',
    streetNumber: '5',
    postalCode: '20121',
    city: 'Milano',
    province: 'MI',
    ...attributes,
  })
}
