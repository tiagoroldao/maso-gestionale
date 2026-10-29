import vine from '@vinejs/vine'

/**
 * An email address that can go in a FatturaPA file: SDI's schema takes
 * only ASCII (no accented letters, in the name or the domain), so a PEC
 * or the company's email is checked for it when entered.
 */
export const fatturaEmail = () =>
  vine
    .string()
    .trim()
    .email({ allow_utf8_local_part: false })
    .regex(/^[\x21-\x7E]+$/)
    .maxLength(254)
