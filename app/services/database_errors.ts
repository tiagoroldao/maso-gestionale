/**
 * Postgres errors that controllers turn into a message instead of a 500.
 * Validation catches them first; these cover two saves racing each other.
 */
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

function code(error: unknown) {
  return (error as { code?: string }).code
}

/**
 * A duplicate value was refused (two people saving the same code at once).
 */
export function isUniqueViolation(error: unknown) {
  return code(error) === UNIQUE_VIOLATION
}

/**
 * A row was still referenced (something started using it after the check).
 */
export function isForeignKeyViolation(error: unknown) {
  return code(error) === FOREIGN_KEY_VIOLATION
}
