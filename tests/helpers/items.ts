import Item from '#models/item'
import Category from '#models/category'
import VatCode from '#models/vat_code'

export function createCategory(attributes: Partial<Category> = {}) {
  return Category.create({ name: 'Raccorderia', markupPercent: '35', ...attributes })
}

let sequence = 0

/**
 * One of the seeded VAT Codes, by name ("22%", "10%"…).
 */
export function vatCode(name = '22%') {
  return VatCode.findByOrFail('name', name)
}

export async function createItem(attributes: Partial<Item> = {}) {
  sequence++
  const standard = await vatCode()
  return Item.create({
    code: `ART${sequence}`,
    description: `Articolo ${sequence}`,
    unit: 'pz',
    vatCodeId: standard.id,
    purchasePrice: '10',
    resalePrice: '13.5',
    ...attributes,
  })
}
