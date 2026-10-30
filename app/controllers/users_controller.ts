import User from '#models/user'
import { createUserValidator, updateUserValidator } from '#validators/user'
import { declareActions, saveActions } from '#shared/screen_actions'
import { urlFor } from '@adonisjs/core/services/url_builder'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Admin management of Office and Technician accounts. Admins and the
 * Superuser are listed for reference but can't be edited here.
 */
export default class UsersController {
  async index({ inertia, bouncer, i18n }: HttpContext) {
    const users = await User.query()
      .whereNot('role', 'superuser')
      .orderBy('isActive', 'desc')
      .orderBy('fullName')

    return inertia.render('users/index', {
      actions: declareActions([
        {
          name: 'new',
          label: i18n.t('ui.users.new'),
          rank: 'primary',
          kind: 'link',
          href: urlFor('users.create'),
        },
      ]),
      users: await Promise.all(
        users.map(async (user) => ({
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          canEdit: await bouncer.allows('editUser', user),
        }))
      ),
    })
  }

  async create({ inertia, i18n }: HttpContext) {
    return inertia.render('users/create', {
      // The screen sits in its form: Save submits it (docs/ui.md "Actions")
      actions: saveActions(i18n.t('ui.users.create')),
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const { fullName, email, role, password } = await request.validateUsing(createUserValidator)
    await User.create({ fullName, email, role, password })

    session.flash('success', i18n.t('flash.userCreated', { name: fullName }))
    response.redirect().toRoute('users.index')
  }

  async edit({ params, inertia, bouncer, i18n }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await bouncer.authorize('editUser', user)

    return inertia.render('users/edit', {
      actions: saveActions(i18n.t('ui.users.saveChanges')),
      account: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
    })
  }

  async update({ params, request, response, session, bouncer, i18n }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await bouncer.authorize('editUser', user)

    const { fullName, email, role, password } = await request.validateUsing(updateUserValidator, {
      meta: { userId: user.id },
    })
    user.merge({ fullName, email, role })
    if (password) user.password = password
    await user.save()

    session.flash('success', i18n.t('flash.userSaved'))
    response.redirect().toRoute('users.index')
  }

  async deactivate({ params, response, session, bouncer, i18n }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await bouncer.authorize('editUser', user)

    user.isActive = false
    await user.save()

    session.flash('success', i18n.t('flash.userDeactivated', { name: user.fullName }))
    response.redirect().toRoute('users.index')
  }

  async reactivate({ params, response, session, bouncer, i18n }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await bouncer.authorize('editUser', user)

    user.isActive = true
    await user.save()

    session.flash('success', i18n.t('flash.userReactivated', { name: user.fullName }))
    response.redirect().toRoute('users.index')
  }
}
