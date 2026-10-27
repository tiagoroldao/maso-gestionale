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
        router.get('items/search', [controllers.Items, 'search'])
        router
          .get('item-documents/:id', [controllers.ItemDocuments, 'show'])
          .where('id', router.matchers.number())
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
        router.get('customers/search', [controllers.Customers, 'search'])
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
        router.get('sites/:id', [controllers.Sites, 'show']).where('id', router.matchers.number())
        router
          .get('sites/:id/edit', [controllers.Sites, 'edit'])
          .where('id', router.matchers.number())
        router.put('sites/:id', [controllers.Sites, 'update']).where('id', router.matchers.number())
        router
          .get('sites/:siteId/equipment/create', [controllers.InstalledEquipment, 'create'])
          .where('siteId', router.matchers.number())
        router
          .post('sites/:siteId/equipment', [controllers.InstalledEquipment, 'store'])
          .where('siteId', router.matchers.number())
        router
          .get('equipment/:id/edit', [controllers.InstalledEquipment, 'edit'])
          .where('id', router.matchers.number())
        router
          .put('equipment/:id', [controllers.InstalledEquipment, 'update'])
          .where('id', router.matchers.number())
      })
      .use(middleware.can('manageCustomers'))

    router
      .group(() => {
        router.get('jobs', [controllers.Jobs, 'index'])
        router.get('jobs/create', [controllers.Jobs, 'create'])
        router.post('jobs', [controllers.Jobs, 'store'])
        router.get('jobs/:id', [controllers.Jobs, 'show']).where('id', router.matchers.number())
        router
          .get('jobs/:id/edit', [controllers.Jobs, 'edit'])
          .where('id', router.matchers.number())
        router.put('jobs/:id', [controllers.Jobs, 'update']).where('id', router.matchers.number())
        router
          .post('jobs/:id/cancel', [controllers.Jobs, 'cancel'])
          .where('id', router.matchers.number())
        router
          .get('jobs/:id/quote', [controllers.Quotes, 'edit'])
          .where('id', router.matchers.number())
        router
          .put('jobs/:id/quote', [controllers.Quotes, 'update'])
          .where('id', router.matchers.number())
        router
          .post('jobs/:id/quote/accept', [controllers.Quotes, 'accept'])
          .where('id', router.matchers.number())
        router
          .post('jobs/:id/quote/decline', [controllers.Quotes, 'decline'])
          .where('id', router.matchers.number())
        router
          .get('jobs/:id/quote.pdf', [controllers.Quotes, 'pdf'])
          .where('id', router.matchers.number())
      })
      .use(middleware.can('manageJobs'))

    router
      .group(() => {
        router.get('items', [controllers.Items, 'index'])
        router.get('items/create', [controllers.Items, 'create'])
        router.post('items', [controllers.Items, 'store'])
        router.get('items/:id', [controllers.Items, 'show']).where('id', router.matchers.number())
        router
          .post('items/:id/receipts', [controllers.StockMovements, 'receive'])
          .where('id', router.matchers.number())
        router
          .post('items/:id/adjustments', [controllers.StockMovements, 'adjust'])
          .where('id', router.matchers.number())
        router.get('stock', [controllers.Stock, 'index'])
        router
          .get('items/:id/edit', [controllers.Items, 'edit'])
          .where('id', router.matchers.number())
        router.put('items/:id', [controllers.Items, 'update']).where('id', router.matchers.number())
        router
          .post('items/:id/archive', [controllers.Items, 'archive'])
          .where('id', router.matchers.number())
        router
          .post('items/:id/unarchive', [controllers.Items, 'unarchive'])
          .where('id', router.matchers.number())
        router
          .delete('items/:id', [controllers.Items, 'destroy'])
          .where('id', router.matchers.number())
        router
          .post('items/:id/documents', [controllers.ItemDocuments, 'store'])
          .where('id', router.matchers.number())
        router
          .delete('item-documents/:id', [controllers.ItemDocuments, 'destroy'])
          .where('id', router.matchers.number())
      })
      .use(middleware.can('manageItems'))

    router
      .group(() => {
        router.get('settings/categories', [controllers.Categories, 'index'])
        router.post('settings/categories', [controllers.Categories, 'store'])
        router
          .put('settings/categories/:id', [controllers.Categories, 'update'])
          .where('id', router.matchers.number())
        router
          .delete('settings/categories/:id', [controllers.Categories, 'destroy'])
          .where('id', router.matchers.number())
        router.get('settings/company', [controllers.CompanySettings, 'edit'])
        router.post('settings/company', [controllers.CompanySettings, 'update'])
        router.get('settings/company/letterhead', [controllers.LetterheadPreview, 'show'])
        router.get('settings/company/letterhead.pdf', [controllers.LetterheadPreview, 'pdf'])
        router.get('settings/rates', [controllers.Rates, 'index'])
        router.post('settings/rates', [controllers.Rates, 'store'])
        router
          .put('settings/rates/:id', [controllers.Rates, 'update'])
          .where('id', router.matchers.number())
        router
          .post('settings/rates/:id/archive', [controllers.Rates, 'archive'])
          .where('id', router.matchers.number())
        router.put('settings/call-out-fee', [controllers.Rates, 'updateCallOutFee'])
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
