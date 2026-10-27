import { scope } from '@adonisjs/lucid/orm'
import { LabourRateSchema } from '#database/schema'

/**
 * An hourly price for a type of labour, billed per technician-hour.
 */
export default class LabourRate extends LabourRateSchema {
  static active = scope((query) => {
    query.whereNull('archived_at')
  })
}
