import { SdiReceivedFileSchema } from '#database/schema'

/**
 * A Supplier Invoice file received through the intermediary (ADR 0019),
 * kept as SDI delivered it until the Supplier Invoice intake (#198) takes
 * it. Each intermediary file is fetched once.
 */
export default class SdiReceivedFile extends SdiReceivedFileSchema {
  static table = 'sdi_received_files'
}
