import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'setup.create': { paramsTuple?: []; params?: {} }
    'setup.store': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'company_settings.logo': { paramsTuple?: []; params?: {} }
    'items.search': { paramsTuple?: []; params?: {} }
    'visit_photos.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.update_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.add_note': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.add_photo': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.add_hours': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.remove_charge': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.add_item': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.set_serviced': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.show_from_visit': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'documentId': ParamValue} }
    'issued_documents.pdf_from_visit': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'documentId': ParamValue} }
    'users.index': { paramsTuple?: []; params?: {} }
    'users.create': { paramsTuple?: []; params?: {} }
    'users.store': { paramsTuple?: []; params?: {} }
    'users.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.deactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.reactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.search': { paramsTuple?: []; params?: {} }
    'customers.index': { paramsTuple?: []; params?: {} }
    'customers.create': { paramsTuple?: []; params?: {} }
    'customers.store': { paramsTuple?: []; params?: {} }
    'customers.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customer_sites.store': { paramsTuple: [ParamValue]; params: {'customerId': ParamValue} }
    'customer_sites.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'customerId': ParamValue,'siteId': ParamValue} }
    'sites.index': { paramsTuple?: []; params?: {} }
    'sites.search': { paramsTuple?: []; params?: {} }
    'sites.create': { paramsTuple?: []; params?: {} }
    'sites.store': { paramsTuple?: []; params?: {} }
    'sites.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'installed_equipment.remove': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'installed_equipment.create': { paramsTuple: [ParamValue]; params: {'siteId': ParamValue} }
    'installed_equipment.store': { paramsTuple: [ParamValue]; params: {'siteId': ParamValue} }
    'installed_equipment.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'installed_equipment.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'template_choices.equipment': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.create': { paramsTuple?: []; params?: {} }
    'issued_documents.store': { paramsTuple?: []; params?: {} }
    'issued_documents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.replace': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.store_replacement': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.index': { paramsTuple?: []; params?: {} }
    'jobs.index': { paramsTuple?: []; params?: {} }
    'jobs.create': { paramsTuple?: []; params?: {} }
    'jobs.store': { paramsTuple?: []; params?: {} }
    'jobs.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.cancel': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.close': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.reopen': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.create': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.schedule': { paramsTuple?: []; params?: {} }
    'visits.to_schedule': { paramsTuple?: []; params?: {} }
    'visits.move': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.mark_done': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.cancel': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.correct': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.update_billing': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.mark_not_billable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.mark_billable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.set_back_to_bill': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.mark_done': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.mark_not_done': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.create': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.import_lines': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.send': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.accept': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.decline': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'template_choices.jobs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'template_choices.items_used': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.index': { paramsTuple?: []; params?: {} }
    'invoices.create': { paramsTuple?: []; params?: {} }
    'invoices.store': { paramsTuple?: []; params?: {} }
    'invoices.store_advance': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.store_from_job': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.store_credit_note': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.finalise': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.xml': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.submission_xml': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'submissionId': ParamValue} }
    'invoices.record_payment': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.remove_payment': { paramsTuple: [ParamValue]; params: {'paymentId': ParamValue} }
    'invoices.prepare_submission': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.confirm_submission': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.record_outcome': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'legacy_invoices.create': { paramsTuple?: []; params?: {} }
    'legacy_invoices.store': { paramsTuple?: []; params?: {} }
    'legacy_invoices.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'legacy_invoices.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'legacy_invoices.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'legacy_invoices.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.index': { paramsTuple?: []; params?: {} }
    'items.create': { paramsTuple?: []; params?: {} }
    'items.store': { paramsTuple?: []; params?: {} }
    'items.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'stock_movements.receive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'stock_movements.adjust': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'stock.index': { paramsTuple?: []; params?: {} }
    'items.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.unarchive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'categories.index': { paramsTuple?: []; params?: {} }
    'categories.store': { paramsTuple?: []; params?: {} }
    'categories.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'categories.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'company_settings.edit': { paramsTuple?: []; params?: {} }
    'company_settings.update': { paramsTuple?: []; params?: {} }
    'letterhead_preview.show': { paramsTuple?: []; params?: {} }
    'letterhead_preview.pdf': { paramsTuple?: []; params?: {} }
    'rates.index': { paramsTuple?: []; params?: {} }
    'rates.store': { paramsTuple?: []; params?: {} }
    'rates.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'rates.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'rates.update_call_out_fee': { paramsTuple?: []; params?: {} }
    'vat_codes.index': { paramsTuple?: []; params?: {} }
    'vat_codes.store': { paramsTuple?: []; params?: {} }
    'vat_codes.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vat_codes.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.index': { paramsTuple?: []; params?: {} }
    'document_templates.create': { paramsTuple?: []; params?: {} }
    'document_templates.store': { paramsTuple?: []; params?: {} }
    'document_templates.preview': { paramsTuple?: []; params?: {} }
    'document_templates.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.fill': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.fill_preview': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vat_rules.index': { paramsTuple?: []; params?: {} }
    'vat_rules.update': { paramsTuple?: []; params?: {} }
    'invoice_numbering.index': { paramsTuple?: []; params?: {} }
    'invoice_numbering.update_sdi_prefix': { paramsTuple?: []; params?: {} }
    'invoice_numbering.update_credit_notes': { paramsTuple?: []; params?: {} }
    'invoice_numbering.update': { paramsTuple: [ParamValue]; params: {'year': ParamValue} }
    'payment_terms.index': { paramsTuple?: []; params?: {} }
    'payment_terms.store': { paramsTuple?: []; params?: {} }
    'payment_terms.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'payment_terms.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'instance': { paramsTuple?: []; params?: {} }
    'instance.update': { paramsTuple?: []; params?: {} }
    'instance.backups': { paramsTuple?: []; params?: {} }
    'instance.backups.run': { paramsTuple?: []; params?: {} }
    'instance.admin_password': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  GET: {
    'setup.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'company_settings.logo': { paramsTuple?: []; params?: {} }
    'items.search': { paramsTuple?: []; params?: {} }
    'visit_photos.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.show_from_visit': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'documentId': ParamValue} }
    'issued_documents.pdf_from_visit': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'documentId': ParamValue} }
    'users.index': { paramsTuple?: []; params?: {} }
    'users.create': { paramsTuple?: []; params?: {} }
    'users.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.search': { paramsTuple?: []; params?: {} }
    'customers.index': { paramsTuple?: []; params?: {} }
    'customers.create': { paramsTuple?: []; params?: {} }
    'customers.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.index': { paramsTuple?: []; params?: {} }
    'sites.search': { paramsTuple?: []; params?: {} }
    'sites.create': { paramsTuple?: []; params?: {} }
    'sites.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'installed_equipment.create': { paramsTuple: [ParamValue]; params: {'siteId': ParamValue} }
    'installed_equipment.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'template_choices.equipment': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.create': { paramsTuple?: []; params?: {} }
    'issued_documents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.replace': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.index': { paramsTuple?: []; params?: {} }
    'jobs.index': { paramsTuple?: []; params?: {} }
    'jobs.create': { paramsTuple?: []; params?: {} }
    'jobs.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.create': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.schedule': { paramsTuple?: []; params?: {} }
    'visits.to_schedule': { paramsTuple?: []; params?: {} }
    'visits.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.create': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'template_choices.jobs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'template_choices.items_used': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.index': { paramsTuple?: []; params?: {} }
    'invoices.create': { paramsTuple?: []; params?: {} }
    'invoices.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.xml': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.submission_xml': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'submissionId': ParamValue} }
    'legacy_invoices.create': { paramsTuple?: []; params?: {} }
    'legacy_invoices.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'legacy_invoices.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.index': { paramsTuple?: []; params?: {} }
    'items.create': { paramsTuple?: []; params?: {} }
    'items.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'stock.index': { paramsTuple?: []; params?: {} }
    'items.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'categories.index': { paramsTuple?: []; params?: {} }
    'company_settings.edit': { paramsTuple?: []; params?: {} }
    'letterhead_preview.show': { paramsTuple?: []; params?: {} }
    'letterhead_preview.pdf': { paramsTuple?: []; params?: {} }
    'rates.index': { paramsTuple?: []; params?: {} }
    'vat_codes.index': { paramsTuple?: []; params?: {} }
    'document_templates.index': { paramsTuple?: []; params?: {} }
    'document_templates.create': { paramsTuple?: []; params?: {} }
    'document_templates.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.fill': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vat_rules.index': { paramsTuple?: []; params?: {} }
    'invoice_numbering.index': { paramsTuple?: []; params?: {} }
    'payment_terms.index': { paramsTuple?: []; params?: {} }
    'instance': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'setup.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'company_settings.logo': { paramsTuple?: []; params?: {} }
    'items.search': { paramsTuple?: []; params?: {} }
    'visit_photos.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.show_from_visit': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'documentId': ParamValue} }
    'issued_documents.pdf_from_visit': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'documentId': ParamValue} }
    'users.index': { paramsTuple?: []; params?: {} }
    'users.create': { paramsTuple?: []; params?: {} }
    'users.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.search': { paramsTuple?: []; params?: {} }
    'customers.index': { paramsTuple?: []; params?: {} }
    'customers.create': { paramsTuple?: []; params?: {} }
    'customers.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.index': { paramsTuple?: []; params?: {} }
    'sites.search': { paramsTuple?: []; params?: {} }
    'sites.create': { paramsTuple?: []; params?: {} }
    'sites.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'installed_equipment.create': { paramsTuple: [ParamValue]; params: {'siteId': ParamValue} }
    'installed_equipment.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'template_choices.equipment': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.create': { paramsTuple?: []; params?: {} }
    'issued_documents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'issued_documents.replace': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.index': { paramsTuple?: []; params?: {} }
    'jobs.index': { paramsTuple?: []; params?: {} }
    'jobs.create': { paramsTuple?: []; params?: {} }
    'jobs.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.create': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.schedule': { paramsTuple?: []; params?: {} }
    'visits.to_schedule': { paramsTuple?: []; params?: {} }
    'visits.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.create': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'template_choices.jobs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'template_choices.items_used': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.index': { paramsTuple?: []; params?: {} }
    'invoices.create': { paramsTuple?: []; params?: {} }
    'invoices.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.xml': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.submission_xml': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'submissionId': ParamValue} }
    'legacy_invoices.create': { paramsTuple?: []; params?: {} }
    'legacy_invoices.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'legacy_invoices.pdf': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.index': { paramsTuple?: []; params?: {} }
    'items.create': { paramsTuple?: []; params?: {} }
    'items.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'stock.index': { paramsTuple?: []; params?: {} }
    'items.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'categories.index': { paramsTuple?: []; params?: {} }
    'company_settings.edit': { paramsTuple?: []; params?: {} }
    'letterhead_preview.show': { paramsTuple?: []; params?: {} }
    'letterhead_preview.pdf': { paramsTuple?: []; params?: {} }
    'rates.index': { paramsTuple?: []; params?: {} }
    'vat_codes.index': { paramsTuple?: []; params?: {} }
    'document_templates.index': { paramsTuple?: []; params?: {} }
    'document_templates.create': { paramsTuple?: []; params?: {} }
    'document_templates.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.fill': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vat_rules.index': { paramsTuple?: []; params?: {} }
    'invoice_numbering.index': { paramsTuple?: []; params?: {} }
    'payment_terms.index': { paramsTuple?: []; params?: {} }
    'instance': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'setup.store': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'my_visits.update_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.add_note': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.add_photo': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.add_hours': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.add_item': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'my_visits.set_serviced': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.store': { paramsTuple?: []; params?: {} }
    'users.deactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.reactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.store': { paramsTuple?: []; params?: {} }
    'customers.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customer_sites.store': { paramsTuple: [ParamValue]; params: {'customerId': ParamValue} }
    'sites.store': { paramsTuple?: []; params?: {} }
    'sites.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'installed_equipment.remove': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'installed_equipment.store': { paramsTuple: [ParamValue]; params: {'siteId': ParamValue} }
    'issued_documents.store': { paramsTuple?: []; params?: {} }
    'issued_documents.store_replacement': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.store': { paramsTuple?: []; params?: {} }
    'jobs.cancel': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.close': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.reopen': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.mark_done': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.cancel': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.mark_not_billable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.mark_billable': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.set_back_to_bill': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.mark_done': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.mark_not_done': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.import_lines': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.send': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.accept': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.decline': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.store': { paramsTuple?: []; params?: {} }
    'invoices.store_advance': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.store_from_job': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.store_credit_note': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.finalise': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.record_payment': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.prepare_submission': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.confirm_submission': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.record_outcome': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'legacy_invoices.store': { paramsTuple?: []; params?: {} }
    'legacy_invoices.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.store': { paramsTuple?: []; params?: {} }
    'stock_movements.receive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'stock_movements.adjust': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.unarchive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'categories.store': { paramsTuple?: []; params?: {} }
    'company_settings.update': { paramsTuple?: []; params?: {} }
    'rates.store': { paramsTuple?: []; params?: {} }
    'rates.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vat_codes.store': { paramsTuple?: []; params?: {} }
    'vat_codes.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.store': { paramsTuple?: []; params?: {} }
    'document_templates.preview': { paramsTuple?: []; params?: {} }
    'document_templates.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.fill_preview': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'payment_terms.store': { paramsTuple?: []; params?: {} }
    'instance.backups.run': { paramsTuple?: []; params?: {} }
  }
  DELETE: {
    'my_visits.remove_charge': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customer_sites.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'customerId': ParamValue,'siteId': ParamValue} }
    'visits.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.remove_payment': { paramsTuple: [ParamValue]; params: {'paymentId': ParamValue} }
    'legacy_invoices.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'item_documents.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'categories.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'payment_terms.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sites.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'installed_equipment.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'visits.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.correct': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'charges.update_billing': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'quotes.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invoices.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'items.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'categories.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'rates.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'rates.update_call_out_fee': { paramsTuple?: []; params?: {} }
    'vat_codes.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'document_templates.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'vat_rules.update': { paramsTuple?: []; params?: {} }
    'invoice_numbering.update_sdi_prefix': { paramsTuple?: []; params?: {} }
    'invoice_numbering.update_credit_notes': { paramsTuple?: []; params?: {} }
    'invoice_numbering.update': { paramsTuple: [ParamValue]; params: {'year': ParamValue} }
    'payment_terms.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'instance.update': { paramsTuple?: []; params?: {} }
    'instance.backups': { paramsTuple?: []; params?: {} }
    'instance.admin_password': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PATCH: {
    'visits.move': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}