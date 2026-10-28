import vine from '@vinejs/vine'

const optionalText = (max: number) => vine.string().trim().maxLength(max).optional()
const optionalDate = () =>
  vine
    .date({ formats: ['YYYY-MM-DD'] })
    .beforeOrEqual('today')
    .optional()

const equipmentFields = {
  equipmentType: vine.string().trim().minLength(1).maxLength(100),
  make: optionalText(100),
  model: optionalText(100),
  serialNumber: optionalText(100),
  installedOn: optionalDate(),
  maintenanceIntervalMonths: vine.number().withoutDecimals().min(1).max(120).optional(),
  lastServicedOn: vine
    .date({ formats: ['YYYY-MM-DD'] })
    .beforeOrEqual('today')
    .afterOrSameAs('installedOn')
    .optional(),
  notes: optionalText(5000),
  itemId: vine.number().exists({ table: 'items', column: 'id' }).optional(),
}

/**
 * Validator for adding Installed Equipment at a Site.
 */
export const installedEquipmentValidator = vine.create(equipmentFields)

/**
 * Editing Installed Equipment also sends the last service date the page loaded, so a date a
 * Visit set since isn't put back (#99).
 */
export const updateInstalledEquipmentValidator = vine.create({
  ...equipmentFields,
  lastServicedOnWas: vine.date({ formats: ['YYYY-MM-DD'] }).optional(),
})

/**
 * Equipment taken out: when, and optionally what replaced it.
 */
export const removeEquipmentValidator = vine.create({
  removedOn: vine.date({ formats: ['YYYY-MM-DD'] }).beforeOrEqual('today'),
  replacedById: vine.number().optional(),
})
