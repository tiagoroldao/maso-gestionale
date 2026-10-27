import Item from '#models/item'
import Category from '#models/category'

export function createCategory(attributes: Partial<Category> = {}) {
  return Category.create({ name: 'Raccorderia', markupPercent: '35', ...attributes })
}

let sequence = 0

export function createItem(attributes: Partial<Item> = {}) {
  sequence++
  return Item.create({
    code: `ART${sequence}`,
    description: `Articolo ${sequence}`,
    unit: 'pz',
    vatRate: '22',
    purchasePrice: '10',
    resalePrice: '13.5',
    ...attributes,
  })
}
