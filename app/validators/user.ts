import vine from '@vinejs/vine'

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().email().maxLength(254)
const password = () => vine.string().minLength(8).maxLength(32)

/**
 * The roles an Admin may give to the accounts they manage.
 */
const managedRole = () => vine.enum(['office', 'technician'] as const)

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

/**
 * Validator for an Admin creating an Office or Technician account
 */
export const createUserValidator = vine.create({
  fullName: vine.string().trim().minLength(1).maxLength(255),
  email: email().unique({ table: 'users', column: 'email', caseInsensitive: true }),
  role: managedRole(),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})

/**
 * Validator for an Admin editing an Office or Technician account. The
 * password is only changed when a new one is given.
 */
export const updateUserValidator = vine.withMetaData<{ userId: number }>().create({
  fullName: vine.string().trim().minLength(1).maxLength(255),
  email: email().unique({
    table: 'users',
    column: 'email',
    caseInsensitive: true,
    filter: (db, _, field) => {
      db.whereNot('id', field.meta.userId)
    },
  }),
  role: managedRole(),
  password: password().optional(),
  passwordConfirmation: password().sameAs('password').optional().requiredIfExists('password'),
})
