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
  items: {
    search: typeof routes['items.search']
    index: typeof routes['items.index']
    create: typeof routes['items.create']
    store: typeof routes['items.store']
    show: typeof routes['items.show']
    edit: typeof routes['items.edit']
    update: typeof routes['items.update']
    archive: typeof routes['items.archive']
    unarchive: typeof routes['items.unarchive']
    destroy: typeof routes['items.destroy']
  }
  itemDocuments: {
    show: typeof routes['item_documents.show']
    store: typeof routes['item_documents.store']
    destroy: typeof routes['item_documents.destroy']
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
    show: typeof routes['customers.show']
    edit: typeof routes['customers.edit']
    update: typeof routes['customers.update']
  }
  customerSites: {
    store: typeof routes['customer_sites.store']
    destroy: typeof routes['customer_sites.destroy']
  }
  sites: {
    index: typeof routes['sites.index']
    search: typeof routes['sites.search']
    create: typeof routes['sites.create']
    store: typeof routes['sites.store']
    show: typeof routes['sites.show']
    edit: typeof routes['sites.edit']
    update: typeof routes['sites.update']
  }
  installedEquipment: {
    create: typeof routes['installed_equipment.create']
    store: typeof routes['installed_equipment.store']
    edit: typeof routes['installed_equipment.edit']
    update: typeof routes['installed_equipment.update']
  }
  stockMovements: {
    receive: typeof routes['stock_movements.receive']
    adjust: typeof routes['stock_movements.adjust']
  }
  stock: {
    index: typeof routes['stock.index']
  }
  categories: {
    index: typeof routes['categories.index']
    store: typeof routes['categories.store']
    update: typeof routes['categories.update']
    destroy: typeof routes['categories.destroy']
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
