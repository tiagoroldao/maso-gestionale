import { SdiReceivedFileSchema } from '#database/schema'

/**
 * A Supplier Invoice file received through the intermediary (ADR 0019),
 * kept as SDI delivered it and handed to the Supplier Invoice intake
 * (#198). Each intermediary file is fetched once.
 */
export default class SdiReceivedFile extends SdiReceivedFileSchema {
  static table = 'sdi_received_files'
}
