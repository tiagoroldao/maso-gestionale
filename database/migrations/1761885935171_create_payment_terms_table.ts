import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'payment_terms'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('name').notNullable().unique()
      table.integer('days').notNullable().defaultTo(0)
      table.check('days >= 0')
      table.boolean('end_of_month').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    /**
     * Every Customer needs Payment Terms, so there is always one to pick.
     */
    this.defer(async (db) => {
      await db.table(this.tableName).insert({
        name: 'Immediate',
        days: 0,
        end_of_month: false,
        created_at: new Date(),
      })
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
