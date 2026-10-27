import vine from '@vinejs/vine'

const optionalText = (max: number) => vine.string().trim().maxLength(max).optional()
const optionalDate = () =>
  vine
    .date({ formats: ['YYYY-MM-DD'] })
    .beforeOrEqual('today')
    .optional()

/**
 * Validator for adding and editing Installed Equipment at a Site.
 */
export const installedEquipmentValidator = vine.create({
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
})
