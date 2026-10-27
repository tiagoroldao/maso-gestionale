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
  instance: typeof routes['instance']
}
