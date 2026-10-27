import InstanceSetup, { SetupAlreadyCompletedError } from '#services/instance_setup'
import { setupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class SetupController {
  async create({ inertia }: HttpContext) {
    return inertia.render('setup', {})
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const input = await request.validateUsing(setupValidator)

    try {
      await InstanceSetup.run({
        superuser: { email: input.superuserEmail, password: input.superuserPassword },
        admin: {
          fullName: input.adminFullName,
          email: input.adminEmail,
          password: input.adminPassword,
        },
      })
    } catch (error) {
      if (!(error instanceof SetupAlreadyCompletedError)) throw error
    }

    session.flash('success', i18n.t('flash.setupComplete'))
    response.redirect().toRoute('session.create')
  }
}
