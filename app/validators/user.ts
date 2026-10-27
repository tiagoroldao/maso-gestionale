import vine from '@vinejs/vine'

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().email().maxLength(254)
const password = () => vine.string().minLength(8).maxLength(32)

/**
 * Validator for the first-run setup, which creates the Superuser
 * and the first Admin of the Instance
 */
export const setupValidator = vine.create({
  superuserEmail: email(),
  superuserPassword: password(),
  superuserPasswordConfirmation: password().sameAs('superuserPassword'),
  adminFullName: vine.string().trim().minLength(1).maxLength(255),
  adminEmail: email().notSameAs('superuserEmail'),
  adminPassword: password(),
  adminPasswordConfirmation: password().sameAs('adminPassword'),
})

/**
 * Validator to use before validating user credentials
 * during login
 */
export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})
