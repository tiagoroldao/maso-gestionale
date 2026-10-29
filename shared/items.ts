import Big from 'big.js'

/**
 * The flags a new Item starts with (#176): Equipment when it has a
 * maintenance interval; Groupable unless it is Equipment or a significant
 * good. Office can change both.
 */
export function itemFlagDefaults(item: {
  maintenanceIntervalMonths: number | null
  significantGood: boolean
}) {
  const equipment = item.maintenanceIntervalMonths !== null
  return { equipment, groupable: !equipment && !item.significantGood }
}

/**
 * Whether a quantity is a whole number, as an Equipment Item's Charge
 * must be: each unit becomes its own Installed Equipment.
 */
export function isWholeQuantity(quantity: string) {
  const value = new Big(quantity)
  return value.eq(value.round(0, Big.roundDown))
}

/**
 * How many units of Installed Equipment a done Equipment Charge creates:
 * its quantity, at least one (a Charge recorded before its Item became
 * Equipment may not be whole: its whole part).
 */
export function equipmentUnits(quantity: string) {
  return Math.max(1, new Big(quantity).round(0, Big.roundDown).toNumber())
}

/**
 * Whether an Equipment Charge keeps a serial number: only for a single
 * unit. Several units' serial numbers are completed on the Site page.
 */
export function takesSerialNumber(quantity: string) {
  return new Big(quantity).eq(1)
}
