/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'
import User from '#models/user'

router
  .group(() => {
    router.get('setup', [controllers.Setup, 'create'])
    router.post('setup', [controllers.Setup, 'store'])

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])
  })
  .use(middleware.guest())

router
  .group(() => {
    router.get('/', ({ auth, response }) => response.redirect(User.homePath(auth.getUserOrFail())))
    router.post('logout', [controllers.Session, 'destroy'])

    router
      .group(() => {
        router.on('/dashboard').renderInertia('dashboard', {}).as('dashboard')
        router.get('company/logo', [controllers.CompanySettings, 'logo'])
      })
      .use(middleware.can('accessBusiness'))

    router
      .group(() => {
        router.get('users', [controllers.Users, 'index'])
        router.get('users/create', [controllers.Users, 'create'])
        router.post('users', [controllers.Users, 'store'])
        router.get('users/:id/edit', [controllers.Users, 'edit'])
        router.put('users/:id', [controllers.Users, 'update'])
        router.post('users/:id/deactivate', [controllers.Users, 'deactivate'])
        router.post('users/:id/reactivate', [controllers.Users, 'reactivate'])
      })
      .use(middleware.can('manageUsers'))

    router
      .group(() => {
        router.get('customers', [controllers.Customers, 'index'])
        router.get('customers/create', [controllers.Customers, 'create'])
        router.post('customers', [controllers.Customers, 'store'])
        router
          .get('customers/:id', [controllers.Customers, 'show'])
          .where('id', router.matchers.number())
        router
          .get('customers/:id/edit', [controllers.Customers, 'edit'])
          .where('id', router.matchers.number())
        router
          .put('customers/:id', [controllers.Customers, 'update'])
          .where('id', router.matchers.number())
        router
          .post('customers/:customerId/sites', [controllers.CustomerSites, 'store'])
          .where('customerId', router.matchers.number())
        router
          .delete('customers/:customerId/sites/:siteId', [controllers.CustomerSites, 'destroy'])
          .where('customerId', router.matchers.number())
          .where('siteId', router.matchers.number())

        router.get('sites', [controllers.Sites, 'index'])
        router.get('sites/search', [controllers.Sites, 'search'])
        router.get('sites/create', [controllers.Sites, 'create'])
        router.post('sites', [controllers.Sites, 'store'])
        router
          .get('sites/:id/edit', [controllers.Sites, 'edit'])
          .where('id', router.matchers.number())
        router.put('sites/:id', [controllers.Sites, 'update']).where('id', router.matchers.number())
      })
      .use(middleware.can('manageCustomers'))

    router
      .group(() => {
        router.get('settings/company', [controllers.CompanySettings, 'edit'])
        router.post('settings/company', [controllers.CompanySettings, 'update'])
        router.get('settings/company/letterhead', [controllers.LetterheadPreview, 'show'])
        router.get('settings/company/letterhead.pdf', [controllers.LetterheadPreview, 'pdf'])
        router.get('settings/payment-terms', [controllers.PaymentTerms, 'index'])
        router.post('settings/payment-terms', [controllers.PaymentTerms, 'store'])
        router.put('settings/payment-terms/:id', [controllers.PaymentTerms, 'update'])
        router.delete('settings/payment-terms/:id', [controllers.PaymentTerms, 'destroy'])
      })
      .use(middleware.can('manageCompany'))

    router
      .group(() => {
        router.on('/instance').renderInertia('instance', {}).as('instance')
      })
      .use(middleware.can('accessInstance'))
  })
  .use(middleware.auth())
