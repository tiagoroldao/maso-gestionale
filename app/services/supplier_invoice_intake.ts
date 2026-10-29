import SupplierInvoices, { SupplierInvoiceRefusedError } from '#services/supplier_invoices'

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
 * Where received Supplier Invoices go. A file it already has (Office
 * uploaded it first, or an earlier poll) counts as taken: it resolves
 * without adding it again. Throwing leaves the file waiting for the next
 * poll.
 */
export interface SupplierInvoiceIntake {
  receive(file: IncomingSupplierInvoice): Promise<void>
}

/**
 * The Supplier Invoice intake (#198), the same way in as Office's
 * uploads. Its `duplicate` refusal means the invoice is already there.
 */
export const supplierInvoicesIntake: SupplierInvoiceIntake = {
  async receive(file) {
    try {
      await SupplierInvoices.receive(
        { contents: file.content, name: file.fileName },
        { via: 'sdi', sdiIdentifier: file.sdiId }
      )
    } catch (error) {
      if (error instanceof SupplierInvoiceRefusedError && error.reason === 'duplicate') return
      throw error
    }
  },
}

/** The intake the poller uses; tests put another in its place */
export const supplierInvoiceIntake: { current: SupplierInvoiceIntake | null } = {
  current: supplierInvoicesIntake,
}
