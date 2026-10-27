import User from '#models/user'
import { errors } from '@adonisjs/auth'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class SessionController {
  async create({ inertia }: HttpContext) {
    return inertia.render('auth/login', {})
  }

  async store({ request, auth, response }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)
    const user = await User.verifyCredentials(email, password)

    /**
     * Same error as a wrong password, so a deactivated account can't be
     * told apart from a non-existent one.
     */
    if (!user.isActive) {
      throw new errors.E_INVALID_CREDENTIALS('Invalid user credentials')
    }

    await auth.use('web').login(user)
    response.redirect().toPath(User.homePath(user))
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    response.redirect().toRoute('session.create')
  }
}
