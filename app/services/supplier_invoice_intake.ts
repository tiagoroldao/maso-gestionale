/**
 * A Supplier Invoice file received through the intermediary, as the
 * poller hands it over.
 */
export type IncomingSupplierInvoice = {
  fileName: string
  /** FatturaPA XML or a signed .p7m, as SDI delivered it */
  content: Buffer
  /** SDI's identifier for the file, when the intermediary gives it */
  sdiId: string | null
}

/**
 * Where received Supplier Invoices go: the Supplier Invoice intake that
 * also takes Office's uploads (#198). A file it already has (Office
 * uploaded it first) counts as taken: it resolves without adding it
 * again. Throwing leaves the file waiting for the next poll.
 */
export interface SupplierInvoiceIntake {
  receive(file: IncomingSupplierInvoice): Promise<void>
}

/**
 * The intake the poller uses. TODO(#198): set it to the Supplier Invoice
 * intake service once #198 is merged. Until then received files wait in
 * `sdi_received_files` and are handed over on the first poll after.
 */
export const supplierInvoiceIntake: { current: SupplierInvoiceIntake | null } = { current: null }
