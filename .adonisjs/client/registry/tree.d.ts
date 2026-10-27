/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  setup: {
    create: typeof routes['setup.create']
    store: typeof routes['setup.store']
  }
  session: {
    create: typeof routes['session.create']
    store: typeof routes['session.store']
    destroy: typeof routes['session.destroy']
  }
  dashboard: typeof routes['dashboard']
  companySettings: {
    logo: typeof routes['company_settings.logo']
    edit: typeof routes['company_settings.edit']
    update: typeof routes['company_settings.update']
  }
  users: {
    index: typeof routes['users.index']
    create: typeof routes['users.create']
    store: typeof routes['users.store']
    edit: typeof routes['users.edit']
    update: typeof routes['users.update']
    deactivate: typeof routes['users.deactivate']
    reactivate: typeof routes['users.reactivate']
  }
  customers: {
    index: typeof routes['customers.index']
    create: typeof routes['customers.create']
    store: typeof routes['customers.store']
    edit: typeof routes['customers.edit']
    update: typeof routes['customers.update']
  }
  letterheadPreview: {
    show: typeof routes['letterhead_preview.show']
    pdf: typeof routes['letterhead_preview.pdf']
  }
  paymentTerms: {
    index: typeof routes['payment_terms.index']
    store: typeof routes['payment_terms.store']
    update: typeof routes['payment_terms.update']
    destroy: typeof routes['payment_terms.destroy']
  }
  instance: typeof routes['instance']
}
