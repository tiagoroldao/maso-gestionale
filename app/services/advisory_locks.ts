/**
 * The keys of the Postgres advisory locks the app takes, in one place so
 * none collides with another. Each is an arbitrary unique number in the
 * 41_000_0NN series, meaning nothing beyond telling the locks apart.
 */
export const ADVISORY_LOCKS = {
  /** First-run setup, so two submissions can't both create accounts */
  instanceSetup: 41_000_001,
  /** Job numbering */
  jobNumbers: 41_000_002,
  /** Finalising Invoices and Credit Notes, and changing how Credit Notes are numbered */
  invoiceNumbering: 41_000_003,
  /** Issued Document numbering, taken together with the template's id */
  issuedDocumentNumbering: 41_000_004,
  /** A running backup, held on a session of its own (Backups.acquireLock) */
  backup: 41_000_005,
} as const
