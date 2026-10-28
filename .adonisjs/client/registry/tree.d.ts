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
    removeCharge: typeof routes['my_visits.remove_charge']
    addItem: typeof routes['my_visits.add_item']
    setServiced: typeof routes['my_visits.set_serviced']
    index: typeof routes['my_visits.index']
  }
  itemDocuments: {
    showFromVisit: typeof routes['item_documents.show_from_visit']
    store: typeof routes['item_documents.store']
    show: typeof routes['item_documents.show']
    destroy: typeof routes['item_documents.destroy']
  }
  issuedDocuments: {
    pdfFromVisit: typeof routes['issued_documents.pdf_from_visit']
    create: typeof routes['issued_documents.create']
    store: typeof routes['issued_documents.store']
    show: typeof routes['issued_documents.show']
    pdf: typeof routes['issued_documents.pdf']
    replace: typeof routes['issued_documents.replace']
    storeReplacement: typeof routes['issued_documents.store_replacement']
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
    archive: typeof routes['customers.archive']
    restore: typeof routes['customers.restore']
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
    archive: typeof routes['sites.archive']
    restore: typeof routes['sites.restore']
  }
  installedEquipment: {
    remove: typeof routes['installed_equipment.remove']
    create: typeof routes['installed_equipment.create']
    store: typeof routes['installed_equipment.store']
    edit: typeof routes['installed_equipment.edit']
    update: typeof routes['installed_equipment.update']
  }
  templateChoices: {
    equipment: typeof routes['template_choices.equipment']
    jobs: typeof routes['template_choices.jobs']
    itemsUsed: typeof routes['template_choices.items_used']
  }
  jobs: {
    index: typeof routes['jobs.index']
    create: typeof routes['jobs.create']
    store: typeof routes['jobs.store']
    show: typeof routes['jobs.show']
    edit: typeof routes['jobs.edit']
    update: typeof routes['jobs.update']
    cancel: typeof routes['jobs.cancel']
    close: typeof routes['jobs.close']
    reopen: typeof routes['jobs.reopen']
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
    markDone: typeof routes['visits.mark_done']
  }
  charges: {
    store: typeof routes['charges.store']
    edit: typeof routes['charges.edit']
    correct: typeof routes['charges.correct']
    updateBilling: typeof routes['charges.update_billing']
    markNotBillable: typeof routes['charges.mark_not_billable']
    markBillable: typeof routes['charges.mark_billable']
    setBackToBill: typeof routes['charges.set_back_to_bill']
  }
  quotes: {
    create: typeof routes['quotes.create']
    store: typeof routes['quotes.store']
    edit: typeof routes['quotes.edit']
    update: typeof routes['quotes.update']
    importLines: typeof routes['quotes.import_lines']
    send: typeof routes['quotes.send']
    accept: typeof routes['quotes.accept']
    decline: typeof routes['quotes.decline']
    pdf: typeof routes['quotes.pdf']
  }
  invoices: {
    index: typeof routes['invoices.index']
    create: typeof routes['invoices.create']
    store: typeof routes['invoices.store']
    storeAdvance: typeof routes['invoices.store_advance']
    storeFromJob: typeof routes['invoices.store_from_job']
    storeCreditNote: typeof routes['invoices.store_credit_note']
    edit: typeof routes['invoices.edit']
    update: typeof routes['invoices.update']
    destroy: typeof routes['invoices.destroy']
    finalise: typeof routes['invoices.finalise']
    pdf: typeof routes['invoices.pdf']
    xml: typeof routes['invoices.xml']
    submissionXml: typeof routes['invoices.submission_xml']
    recordPayment: typeof routes['invoices.record_payment']
    removePayment: typeof routes['invoices.remove_payment']
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
  documentTemplates: {
    index: typeof routes['document_templates.index']
    create: typeof routes['document_templates.create']
    store: typeof routes['document_templates.store']
    preview: typeof routes['document_templates.preview']
    edit: typeof routes['document_templates.edit']
    update: typeof routes['document_templates.update']
    archive: typeof routes['document_templates.archive']
    restore: typeof routes['document_templates.restore']
    fill: typeof routes['document_templates.fill']
    fillPreview: typeof routes['document_templates.fill_preview']
  }
  vatRules: {
    index: typeof routes['vat_rules.index']
    update: typeof routes['vat_rules.update']
  }
  invoiceNumbering: {
    index: typeof routes['invoice_numbering.index']
    updateSdiPrefix: typeof routes['invoice_numbering.update_sdi_prefix']
    updateCreditNotes: typeof routes['invoice_numbering.update_credit_notes']
    update: typeof routes['invoice_numbering.update']
  }
  paymentTerms: {
    index: typeof routes['payment_terms.index']
    store: typeof routes['payment_terms.store']
    update: typeof routes['payment_terms.update']
    destroy: typeof routes['payment_terms.destroy']
  }
  instance: typeof routes['instance'] & {
    update: typeof routes['instance.update']
    adminPassword: typeof routes['instance.admin_password']
  }
}
