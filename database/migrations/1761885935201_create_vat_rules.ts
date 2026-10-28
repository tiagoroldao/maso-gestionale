import { BaseSchema } from '@adonisjs/lucid/schema'

const CUSTOMER_TYPES = ['private', 'company', 'condominium', 'organisation']
const WORK_CATEGORIES = ['new_installation', 'maintenance', 'renovation', 'repair', 'sale']
const LINE_KINDS = ['labour', 'material', 'significant_good']
const BUILDING_WORK = ['new_installation', 'maintenance', 'renovation', 'repair']

/**
 * Our reading of the law until the commercialista reviews it (#17):
 * homes maintained or renovated for people, condominiums and ente → 10%;
 * building work for companies → reverse charge N6.7; the rest → 22%.
 */
// The standard rate, should the Admin have archived the code a rule wants
const STANDARD = `(SELECT id FROM vat_codes WHERE natura IS NULL AND archived_at IS NULL
  ORDER BY rate DESC, name LIMIT 1)`
const active = (condition: string) =>
  `coalesce((SELECT id FROM vat_codes WHERE ${condition} AND archived_at IS NULL ORDER BY id LIMIT 1), ${STANDARD})`

function seededCode(customerType: string, workCategory: string, residential: boolean) {
  if (
    customerType !== 'company' &&
    residential &&
    (workCategory === 'maintenance' || workCategory === 'renovation')
  ) {
    return active('rate = 10 AND natura IS NULL')
  }
  if (customerType === 'company' && BUILDING_WORK.includes(workCategory)) {
    return active("natura = 'N6.7'")
  }
  return active('rate = 22 AND natura IS NULL')
}

export default class extends BaseSchema {
  async up() {
    // The VAT Code a new line of a Job's Invoice or Quote gets (ADR 0008)
    this.schema.createTable('vat_rules', (table) => {
      table.increments('id').notNullable()
      table.string('customer_type', 20).notNullable()
      table.string('work_category', 20).notNullable()
      // Whether the Job's Site is mainly residential
      table.boolean('residential').notNullable()
      table.string('line_kind', 20).notNullable()
      table
        .integer('vat_code_id')
        .notNullable()
        .references('id')
        .inTable('vat_codes')
        .onDelete('RESTRICT')
      table.unique(['customer_type', 'work_category', 'residential', 'line_kind'])
      table.timestamp('updated_at').nullable()
    })
    const list = (values: string[]) => values.map((value) => `'${value}'`).join(', ')
    this.schema.raw(`ALTER TABLE vat_rules ADD CONSTRAINT vat_rules_values_check CHECK (
      customer_type IN (${list(CUSTOMER_TYPES)})
      AND work_category IN (${list(WORK_CATEGORIES)})
      AND line_kind IN (${list(LINE_KINDS)}))`)

    // Every combination, so the Admin edits a full table
    const rows = CUSTOMER_TYPES.flatMap((customerType) =>
      WORK_CATEGORIES.flatMap((workCategory) =>
        [true, false].flatMap((residential) =>
          LINE_KINDS.map(
            (lineKind) =>
              `('${customerType}', '${workCategory}', ${residential}, '${lineKind}', ${seededCode(customerType, workCategory, residential)})`
          )
        )
      )
    )
    this.schema.raw(
      `INSERT INTO vat_rules (customer_type, work_category, residential, line_kind, vat_code_id) VALUES ${rows.join(',\n')}`
    )
  }

  async down() {
    this.schema.dropTable('vat_rules')
  }
}
