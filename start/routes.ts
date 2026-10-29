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
          .get('visit-photos/:id', [controllers.VisitPhotos, 'show'])
          .where('id', router.matchers.number())
        router
          .get('my-visits/:id', [controllers.MyVisits, 'show'])
          .where('id', router.matchers.number())
        router
          .post('my-visits/:id/status', [controllers.MyVisits, 'updateStatus'])
          .where('id', router.matchers.number())
        router
          .post('my-visits/:id/notes', [controllers.MyVisits, 'addNote'])
          .where('id', router.matchers.number())
        router
          .post('my-visits/:id/photos', [controllers.MyVisits, 'addPhoto'])
          .where('id', router.matchers.number())
        router
          .post('my-visits/:id/hours', [controllers.MyVisits, 'addHours'])
          .where('id', router.matchers.number())
        router
          .delete('charges/:id', [controllers.MyVisits, 'removeCharge'])
          .where('id', router.matchers.number())
        router
          .post('my-visits/:id/items', [controllers.MyVisits, 'addItem'])
          .where('id', router.matchers.number())
        router
          .post('my-visits/:id/serviced', [controllers.MyVisits, 'setServiced'])
          .where('id', router.matchers.number())
        router
          .get('my-visits/:id/item-documents/:documentId', [
            controllers.ItemDocuments,
            'showFromVisit',
          ])
          .where('id', router.matchers.number())
          .where('documentId', router.matchers.number())
        router
          .get('my-visits/:id/issued-documents/:documentId', [
            controllers.IssuedDocuments,
            'pdfFromVisit',
          ])
          .where('id', router.matchers.number())
          .where('documentId', router.matchers.number())
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
          .post('customers/:id/archive', [controllers.Customers, 'archive'])
          .where('id', router.matchers.number())
        router
          .post('customers/:id/restore', [controllers.Customers, 'restore'])
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
          .post('sites/:id/archive', [controllers.Sites, 'archive'])
          .where('id', router.matchers.number())
        router
          .post('sites/:id/restore', [controllers.Sites, 'restore'])
          .where('id', router.matchers.number())
        router
          .post('equipment/:id/remove', [controllers.InstalledEquipment, 'remove'])
          .where('id', router.matchers.number())
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
        router
          .get('sites/:id/installed-equipment', [controllers.TemplateChoices, 'equipment'])
          .where('id', router.matchers.number())
        router.get('issued-documents/create', [controllers.IssuedDocuments, 'create'])
        router.post('issued-documents', [controllers.IssuedDocuments, 'store'])
        router
          .get('issued-documents/:id', [controllers.IssuedDocuments, 'show'])
          .where('id', router.matchers.number())
        router
          .get('issued-documents/:id/pdf', [controllers.IssuedDocuments, 'pdf'])
          .where('id', router.matchers.number())
        router
          .get('issued-documents/:id/replace', [controllers.IssuedDocuments, 'replace'])
          .where('id', router.matchers.number())
        router
          .post('issued-documents/:id/replace', [controllers.IssuedDocuments, 'storeReplacement'])
          .where('id', router.matchers.number())
      })
      .use(middleware.can('manageCustomers'))

    router
      .group(() => {
        router.get('my-visits', [controllers.MyVisits, 'index'])
      })
      .use(middleware.can('workInField'))

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
          .post('jobs/:id/close', [controllers.Jobs, 'close'])
          .where('id', router.matchers.number())
        router
          .post('jobs/:id/reopen', [controllers.Jobs, 'reopen'])
          .where('id', router.matchers.number())
        router
          .get('jobs/:id/visits/create', [controllers.Visits, 'create'])
          .where('id', router.matchers.number())
        router
          .post('jobs/:id/visits', [controllers.Visits, 'store'])
          .where('id', router.matchers.number())
        router.get('agenda', [controllers.Visits, 'schedule'])
        router.get('agenda/to-schedule', [controllers.Visits, 'toSchedule'])
        router
          .patch('visits/:id/move', [controllers.Visits, 'move'])
          .where('id', router.matchers.number())
        router
          .get('visits/:id/edit', [controllers.Visits, 'edit'])
          .where('id', router.matchers.number())
        router
          .put('visits/:id', [controllers.Visits, 'update'])
          .where('id', router.matchers.number())
        router
          .delete('visits/:id', [controllers.Visits, 'destroy'])
          .where('id', router.matchers.number())
        router
          .post('visits/:id/done', [controllers.Visits, 'markDone'])
          .where('id', router.matchers.number())
        router
          .post('visits/:id/cancel', [controllers.Visits, 'cancel'])
          .where('id', router.matchers.number())
        router
          .post('visits/:id/restore', [controllers.Visits, 'restore'])
          .where('id', router.matchers.number())
        router
          .post('jobs/:id/charges', [controllers.Charges, 'store'])
          .where('id', router.matchers.number())
        router
          .get('charges/:id/edit', [controllers.Charges, 'edit'])
          .where('id', router.matchers.number())
        router
          .put('charges/:id/recorded', [controllers.Charges, 'correct'])
          .where('id', router.matchers.number())
        router
          .put('charges/:id/billing', [controllers.Charges, 'updateBilling'])
          .where('id', router.matchers.number())
        router
          .post('charges/:id/not-billable', [controllers.Charges, 'markNotBillable'])
          .where('id', router.matchers.number())
        router
          .post('charges/:id/billable', [controllers.Charges, 'markBillable'])
          .where('id', router.matchers.number())
        router
          .post('charges/:id/to-bill', [controllers.Charges, 'setBackToBill'])
          .where('id', router.matchers.number())
        router
          .post('charges/:id/done', [controllers.Charges, 'markDone'])
          .where('id', router.matchers.number())
        router
          .post('charges/:id/not-done', [controllers.Charges, 'markNotDone'])
          .where('id', router.matchers.number())
        router
          .get('jobs/:id/quotes/create', [controllers.Quotes, 'create'])
          .where('id', router.matchers.number())
        router
          .post('jobs/:id/quotes', [controllers.Quotes, 'store'])
          .where('id', router.matchers.number())
        router.get('quotes/:id', [controllers.Quotes, 'edit']).where('id', router.matchers.number())
        router
          .put('quotes/:id', [controllers.Quotes, 'update'])
          .where('id', router.matchers.number())
        router
          .post('quotes/:id/import', [controllers.Quotes, 'importLines'])
          .where('id', router.matchers.number())
        router
          .post('quotes/:id/send', [controllers.Quotes, 'send'])
          .where('id', router.matchers.number())
        router
          .post('quotes/:id/accept', [controllers.Quotes, 'accept'])
          .where('id', router.matchers.number())
        router
          .post('quotes/:id/decline', [controllers.Quotes, 'decline'])
          .where('id', router.matchers.number())
        router
          .get('quotes/:id/pdf', [controllers.Quotes, 'pdf'])
          .where('id', router.matchers.number())
        router
          .get('customers/:id/jobs', [controllers.TemplateChoices, 'jobs'])
          .where('id', router.matchers.number())
        router
          .get('jobs/:id/items-used', [controllers.TemplateChoices, 'itemsUsed'])
          .where('id', router.matchers.number())
      })
      .use(middleware.can('manageJobs'))

    router
      .group(() => {
        router.get('invoices', [controllers.Invoices, 'index'])
        router.get('invoices/create', [controllers.Invoices, 'create'])
        router.post('invoices', [controllers.Invoices, 'store'])
        router
          .post('jobs/:id/advance-invoices', [controllers.Invoices, 'storeAdvance'])
          .where('id', router.matchers.number())
        router
          .post('jobs/:id/invoices', [controllers.Invoices, 'storeFromJob'])
          .where('id', router.matchers.number())
        router
          .post('invoices/:id/credit-notes', [controllers.Invoices, 'storeCreditNote'])
          .where('id', router.matchers.number())
        router
          .get('invoices/:id/edit', [controllers.Invoices, 'edit'])
          .where('id', router.matchers.number())
        router
          .put('invoices/:id', [controllers.Invoices, 'update'])
          .where('id', router.matchers.number())
        router
          .delete('invoices/:id', [controllers.Invoices, 'destroy'])
          .where('id', router.matchers.number())
        router
          .post('invoices/:id/finalise', [controllers.Invoices, 'finalise'])
          .where('id', router.matchers.number())
        router
          .get('invoices/:id/pdf', [controllers.Invoices, 'pdf'])
          .where('id', router.matchers.number())
        router
          .get('invoices/:id/xml', [controllers.Invoices, 'xml'])
          .where('id', router.matchers.number())
        router
          .get('invoices/:id/submissions/:submissionId/xml', [
            controllers.Invoices,
            'submissionXml',
          ])
          .where('id', router.matchers.number())
          .where('submissionId', router.matchers.number())
        router
          .post('invoices/:id/payments', [controllers.Invoices, 'recordPayment'])
          .where('id', router.matchers.number())
        router
          .delete('payments/:paymentId', [controllers.Invoices, 'removePayment'])
          .where('paymentId', router.matchers.number())
        router
          .post('invoices/:id/submissions', [controllers.Invoices, 'prepareSubmission'])
          .where('id', router.matchers.number())
        router
          .post('invoices/:id/submissions/confirm', [controllers.Invoices, 'confirmSubmission'])
          .where('id', router.matchers.number())
        router
          .post('invoices/:id/submissions/outcome', [controllers.Invoices, 'recordOutcome'])
          .where('id', router.matchers.number())
        // Legacy Invoices (#27): entered by hand, outside the SDI flow
        router.get('invoices/legacy/create', [controllers.LegacyInvoices, 'create'])
        router.post('invoices/legacy', [controllers.LegacyInvoices, 'store'])
        router
          .get('invoices/:id/legacy', [controllers.LegacyInvoices, 'show'])
          .where('id', router.matchers.number())
        // POST, as the form may carry a new PDF
        router
          .post('invoices/:id/legacy', [controllers.LegacyInvoices, 'update'])
          .where('id', router.matchers.number())
        router
          .delete('invoices/:id/legacy', [controllers.LegacyInvoices, 'destroy'])
          .where('id', router.matchers.number())
        router
          .get('invoices/:id/legacy/pdf', [controllers.LegacyInvoices, 'pdf'])
          .where('id', router.matchers.number())
      })
      .use(middleware.can('manageInvoices'))

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
          .get('item-documents/:id', [controllers.ItemDocuments, 'show'])
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
        router.get('settings/vat-codes', [controllers.VatCodes, 'index'])
        router.post('settings/vat-codes', [controllers.VatCodes, 'store'])
        router
          .put('settings/vat-codes/:id', [controllers.VatCodes, 'update'])
          .where('id', router.matchers.number())
        router
          .post('settings/vat-codes/:id/archive', [controllers.VatCodes, 'archive'])
          .where('id', router.matchers.number())
        router.get('settings/document-templates', [controllers.DocumentTemplates, 'index'])
        router.get('settings/document-templates/new', [controllers.DocumentTemplates, 'create'])
        router.post('settings/document-templates', [controllers.DocumentTemplates, 'store'])
        router.post('settings/document-templates/preview', [
          controllers.DocumentTemplates,
          'preview',
        ])
        router
          .get('settings/document-templates/:id/edit', [controllers.DocumentTemplates, 'edit'])
          .where('id', router.matchers.number())
        router
          .put('settings/document-templates/:id', [controllers.DocumentTemplates, 'update'])
          .where('id', router.matchers.number())
        router
          .post('settings/document-templates/:id/archive', [
            controllers.DocumentTemplates,
            'archive',
          ])
          .where('id', router.matchers.number())
        router
          .post('settings/document-templates/:id/restore', [
            controllers.DocumentTemplates,
            'restore',
          ])
          .where('id', router.matchers.number())
        router
          .get('settings/document-templates/:id/fill', [controllers.DocumentTemplates, 'fill'])
          .where('id', router.matchers.number())
        router
          .post('settings/document-templates/:id/fill', [
            controllers.DocumentTemplates,
            'fillPreview',
          ])
          .where('id', router.matchers.number())
        router.get('settings/vat-rules', [controllers.VatRules, 'index'])
        router.put('settings/vat-rules', [controllers.VatRules, 'update'])
        router.get('settings/invoice-numbering', [controllers.InvoiceNumbering, 'index'])
        router.put('settings/invoice-numbering/sdi-prefix', [
          controllers.InvoiceNumbering,
          'updateSdiPrefix',
        ])
        router.put('settings/invoice-numbering/credit-notes', [
          controllers.InvoiceNumbering,
          'updateCreditNotes',
        ])
        router
          .put('settings/invoice-numbering/:year', [controllers.InvoiceNumbering, 'update'])
          .where('year', router.matchers.number())
        router.get('settings/payment-terms', [controllers.PaymentTerms, 'index'])
        router.post('settings/payment-terms', [controllers.PaymentTerms, 'store'])
        router.put('settings/payment-terms/:id', [controllers.PaymentTerms, 'update'])
        router.delete('settings/payment-terms/:id', [controllers.PaymentTerms, 'destroy'])
      })
      .use(middleware.can('manageCompany'))

    router
      .group(() => {
        router.get('/instance', [controllers.Instance, 'show']).as('instance')
        router.put('/instance', [controllers.Instance, 'update']).as('instance.update')
        router
          .put('/instance/admins/:id/password', [controllers.Instance, 'setAdminPassword'])
          .where('id', router.matchers.number())
          .as('instance.admin_password')
      })
      .use(middleware.can('accessInstance'))
  })
  .use(middleware.auth())
