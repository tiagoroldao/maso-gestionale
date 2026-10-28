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
  visitPhotos: {
    show: typeof routes['visit_photos.show']
  }
  myVisits: {
    show: typeof routes['my_visits.show']
    updateStatus: typeof routes['my_visits.update_status']
    addNote: typeof routes['my_visits.add_note']
    addPhoto: typeof routes['my_visits.add_photo']
    addHours: typeof routes['my_visits.add_hours']
    removeHours: typeof routes['my_visits.remove_hours']
    addItem: typeof routes['my_visits.add_item']
    removeItem: typeof routes['my_visits.remove_item']
    index: typeof routes['my_visits.index']
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
    search: typeof routes['customers.search']
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
  jobs: {
    index: typeof routes['jobs.index']
    create: typeof routes['jobs.create']
    store: typeof routes['jobs.store']
    show: typeof routes['jobs.show']
    edit: typeof routes['jobs.edit']
    update: typeof routes['jobs.update']
    cancel: typeof routes['jobs.cancel']
  }
  visits: {
    create: typeof routes['visits.create']
    store: typeof routes['visits.store']
    schedule: typeof routes['visits.schedule']
    toSchedule: typeof routes['visits.to_schedule']
    move: typeof routes['visits.move']
    edit: typeof routes['visits.edit']
    update: typeof routes['visits.update']
    destroy: typeof routes['visits.destroy']
  }
  quotes: {
    edit: typeof routes['quotes.edit']
    update: typeof routes['quotes.update']
    accept: typeof routes['quotes.accept']
    decline: typeof routes['quotes.decline']
    pdf: typeof routes['quotes.pdf']
  }
  invoices: {
    index: typeof routes['invoices.index']
    create: typeof routes['invoices.create']
    store: typeof routes['invoices.store']
    storeFromJob: typeof routes['invoices.store_from_job']
    edit: typeof routes['invoices.edit']
    update: typeof routes['invoices.update']
    destroy: typeof routes['invoices.destroy']
    finalise: typeof routes['invoices.finalise']
    pdf: typeof routes['invoices.pdf']
    xml: typeof routes['invoices.xml']
    prepareSubmission: typeof routes['invoices.prepare_submission']
    confirmSubmission: typeof routes['invoices.confirm_submission']
    recordOutcome: typeof routes['invoices.record_outcome']
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
  rates: {
    index: typeof routes['rates.index']
    store: typeof routes['rates.store']
    update: typeof routes['rates.update']
    archive: typeof routes['rates.archive']
    updateCallOutFee: typeof routes['rates.update_call_out_fee']
  }
  vatCodes: {
    index: typeof routes['vat_codes.index']
    store: typeof routes['vat_codes.store']
    update: typeof routes['vat_codes.update']
    archive: typeof routes['vat_codes.archive']
  }
  invoiceNumbering: {
    index: typeof routes['invoice_numbering.index']
    updateSdiPrefix: typeof routes['invoice_numbering.update_sdi_prefix']
    update: typeof routes['invoice_numbering.update']
  }
  paymentTerms: {
    index: typeof routes['payment_terms.index']
    store: typeof routes['payment_terms.store']
    update: typeof routes['payment_terms.update']
    destroy: typeof routes['payment_terms.destroy']
  }
  instance: typeof routes['instance']
}
