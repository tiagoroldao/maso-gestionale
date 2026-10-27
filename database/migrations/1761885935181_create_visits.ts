import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('visits', (table) => {
      table.increments('id').notNullable()
      table.integer('job_id').notNullable().references('id').inTable('jobs').onDelete('CASCADE')
      table.timestamp('starts_at').notNullable()
      table.timestamp('ends_at').notNullable()
      table.check('ends_at > starts_at')
      // Updated by Technicians from #15; 'needs_return' feeds the to-schedule list
      table
        .enum('status', ['planned', 'in_progress', 'done', 'needs_return'])
        .notNullable()
        .defaultTo('planned')
      table.text('notes').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.index(['job_id'])
      table.index(['starts_at'])
    })

    this.schema.createTable('visit_technicians', (table) => {
      table.integer('visit_id').notNullable().references('id').inTable('visits').onDelete('CASCADE')
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT')
      table.primary(['visit_id', 'user_id'])
      table.index(['user_id'])
    })
  }

  async down() {
    this.schema.dropTable('visit_technicians')
    this.schema.dropTable('visits')
  }
}
