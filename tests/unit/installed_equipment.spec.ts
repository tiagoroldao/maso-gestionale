import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import InstalledEquipment from '#models/installed_equipment'

function equipment(attributes: Partial<InstalledEquipment>) {
  return new InstalledEquipment().merge({ equipmentType: 'Boiler', ...attributes })
}

test.group('Installed Equipment next due date', () => {
  test('counts from the last service', ({ assert }) => {
    const boiler = equipment({
      installedOn: DateTime.fromISO('2020-03-15'),
      lastServicedOn: DateTime.fromISO('2026-01-10'),
      maintenanceIntervalMonths: 12,
    })
    assert.equal(boiler.nextDueOn?.toISODate(), '2027-01-10')
  })

  test('counts from installation when never serviced', ({ assert }) => {
    const boiler = equipment({
      installedOn: DateTime.fromISO('2025-08-31'),
      maintenanceIntervalMonths: 6,
    })
    assert.equal(boiler.nextDueOn?.toISODate(), '2026-02-28')
  })

  test('is unknown without an interval or a date', ({ assert }) => {
    assert.isNull(equipment({ installedOn: DateTime.fromISO('2025-01-01') }).nextDueOn)
    assert.isNull(equipment({ maintenanceIntervalMonths: 12 }).nextDueOn)
  })

  test('describes itself by type, make and model', ({ assert }) => {
    assert.equal(
      equipment({ make: 'Vaillant', model: 'ecoTEC plus' }).description,
      'Boiler — Vaillant ecoTEC plus'
    )
    assert.equal(equipment({}).description, 'Boiler')
  })
})
