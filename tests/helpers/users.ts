import User, { type Role } from '#models/user'

let sequence = 0

/**
 * Creates a user with the given role. The password is always "password".
 */
export function createUser(
  role: Role,
  overrides: Partial<Pick<User, 'fullName' | 'email' | 'isActive'>> = {}
) {
  sequence++
  return User.create({
    fullName: `${role} ${sequence}`,
    email: `${role}${sequence}@example.com`,
    password: 'password',
    role,
    ...overrides,
  })
}
