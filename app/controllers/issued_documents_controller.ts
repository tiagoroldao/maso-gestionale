import Customer from '#models/customer'
import DocumentTemplate from '#models/document_template'
import IssuedDocument from '#models/issued_document'
import InstalledEquipment from '#models/installed_equipment'
import Job from '#models/job'
import Site from '#models/site'
import Visit from '#models/visit'
import { PdfConversionError } from '#documents/pdf_converter'
import DocumentTemplates from '#services/document_templates'
import IssuedDocuments, { IssuingRefusedError } from '#services/issued_documents'
import { TemplateDataError } from '#services/template_data'
import { issuedDocumentValidator, replacementValidator } from '#validators/issued_document'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Issued Documents (#31): Office and Admin issue a Document Template for
 * a Customer, open it and issue replacements; Technicians open a Site's
 * from a Visit they are assigned to. Nothing here edits or deletes one.
 */
export default class IssuedDocumentsController {
  /**
   * Choosing a template, then filling it in (for a Customer when one is
   * given).
   */
  async create({ request, inertia }: HttpContext) {
    const templateId = Number(request.input('templateId'))
    const customerId = Number(request.input('customerId'))
    const customer = customerId
      ? await Customer.query()
          .withScopes((scopes) => scopes.active())
          .where('id', customerId)
          .first()
      : null
    const picked = customer
      ? { id: customer.id, displayName: customer.displayName, city: customer.city }
      : null
    const template = templateId
      ? await DocumentTemplate.query()
          .withScopes((scopes) => scopes.active())
          .where('id', templateId)
          .first()
      : null

    if (!template) {
      const templates = await DocumentTemplate.query()
        .withScopes((scopes) => scopes.active())
        .orderBy('name')
      return inertia.render('issued_documents/create', {
        templates: templates.map((one) => ({ id: one.id, name: one.name })),
        template: null,
        customer: picked,
        replaces: null,
        prefill: {},
      })
    }

    const current = await DocumentTemplates.current(template)
    return inertia.render('issued_documents/create', {
      templates: [],
      template: { id: template.id, name: current.name, fields: current.fields },
      customer: picked,
      replaces: null,
      prefill: {},
    })
  }

  /**
   * Issues it: JSON with the new document's id and number, or by field
   * key what doesn't fit (`customerId` for the Customer, `templateId` for
   * the template).
   */
  async store({ request, response, i18n, auth, logger }: HttpContext) {
    const data = await request.validateUsing(issuedDocumentValidator)
    const template = await DocumentTemplate.findOrFail(data.templateId)
    return this.issue({ response, i18n, auth, logger }, template, data, null)
  }

  async show({ params, inertia }: HttpContext) {
    const document = await IssuedDocument.query()
      .where('id', params.id)
      .preload('version')
      .preload('customer')
      .preload('template')
      .preload('replacedBy')
      .preload('replaces')
      .firstOrFail()
    const site = document.siteId ? await Site.find(document.siteId) : null
    const equipment = document.installedEquipmentId
      ? await InstalledEquipment.find(document.installedEquipmentId)
      : null
    const job = document.jobId ? await Job.find(document.jobId) : null
    const link = (other: IssuedDocument | null) =>
      other ? { id: other.id, number: other.number } : null

    return inertia.render('issued_documents/show', {
      document: {
        id: document.id,
        number: document.number,
        title: document.version.name,
        issuedOn: document.issuedOn.toISODate()!,
        customer: { id: document.customer.id, displayName: document.customer.displayName },
        site: site && { id: site.id, summary: site.summary },
        equipment: equipment && { id: equipment.id, description: equipment.description },
        job: job && { id: job.id, number: job.number, title: job.title },
        replacedBy: link(document.replacedBy),
        replaces: link(document.replaces),
        canReplace: document.replacedById === null && document.template.archivedAt === null,
      },
    })
  }

  async pdf({ params, response, logger, i18n }: HttpContext) {
    const document = await IssuedDocument.findOrFail(params.id)
    return this.sendPdf(document, { response, logger, i18n })
  }

  /**
   * A replacement's form, prefilled from the original for the template's
   * current fields.
   */
  async replace({ params, inertia, response, session, i18n }: HttpContext) {
    const original = await IssuedDocument.query()
      .where('id', params.id)
      .preload('customer')
      .preload('template')
      .firstOrFail()
    if (original.replacedById !== null || original.template.archivedAt !== null) {
      const reason = original.replacedById ? 'alreadyReplaced' : 'templateArchived'
      session.flash('error', this.refusal(reason, i18n))
      return response.redirect().toRoute('issued_documents.show', { id: original.id })
    }
    const current = await DocumentTemplates.current(original.template)
    const { customer } = original

    return inertia.render('issued_documents/create', {
      templates: [],
      template: { id: original.template.id, name: current.name, fields: current.fields },
      customer: { id: customer.id, displayName: customer.displayName, city: customer.city },
      replaces: { id: original.id, number: original.number },
      prefill: await IssuedDocuments.prefill(original, current.fields),
    })
  }

  /**
   * Issues the replacement: the original's template, the next number.
   */
  async storeReplacement({ params, request, response, i18n, auth, logger }: HttpContext) {
    const original = await IssuedDocument.query()
      .where('id', params.id)
      .preload('template')
      .firstOrFail()
    const data = await request.validateUsing(replacementValidator)
    return this.issue({ response, i18n, auth, logger }, original.template, data, original)
  }

  /**
   * For a Technician on a Visit: an Issued Document of the Visit's Site
   * that hasn't been replaced.
   */
  async pdfFromVisit({ params, response, logger, i18n, bouncer }: HttpContext) {
    const visit = await Visit.query().where('id', params.id).preload('job').firstOrFail()
    await bouncer.authorize('viewVisit', visit)
    const document = await IssuedDocument.query()
      .where('id', params.documentId)
      .whereNull('replacedById')
      .whereNotNull('siteId')
      .where('siteId', visit.job.siteId ?? 0)
      .first()
    if (!document) return response.notFound()
    return this.sendPdf(document, { response, logger, i18n })
  }

  private async issue(
    { response, i18n, auth, logger }: Pick<HttpContext, 'response' | 'i18n' | 'auth' | 'logger'>,
    template: DocumentTemplate,
    data: { customerId?: number | null; values?: Record<string, unknown> },
    original: IssuedDocument | null
  ) {
    const customer = data.customerId
      ? await Customer.query()
          .withScopes((scopes) => scopes.active())
          .where('id', data.customerId)
          .first()
      : null
    if (!customer) {
      return response.unprocessableEntity({
        errors: { customerId: i18n.t('errors.templateData.customer') } as Record<string, string>,
      })
    }

    try {
      const document = await IssuedDocuments.issue(
        template,
        customer,
        data.values ?? {},
        i18n,
        auth.getUserOrFail(),
        original
      )
      // Stored now, so it prints today's layout and logo; if Gotenberg is
      // down, the first request for the PDF stores it instead
      await IssuedDocuments.pdf(document, i18n).catch((error) => {
        if (!(error instanceof PdfConversionError)) throw error
        logger.warn({ err: error }, 'PDF conversion failed after issuing')
      })
      return { id: document.id, number: document.number }
    } catch (error) {
      if (error instanceof TemplateDataError) {
        return response.unprocessableEntity({ errors: error.errors })
      }
      if (error instanceof IssuingRefusedError) {
        return response.unprocessableEntity({
          errors: { templateId: this.refusal(error.reason, i18n) } as Record<string, string>,
        })
      }
      throw error
    }
  }

  private refusal(reason: IssuingRefusedError['reason'], i18n: HttpContext['i18n']) {
    return i18n.t(`errors.issuedDocuments.${reason}`)
  }

  private async sendPdf(
    document: IssuedDocument,
    { response, logger, i18n }: Pick<HttpContext, 'response' | 'logger' | 'i18n'>
  ) {
    try {
      const pdf = await IssuedDocuments.pdf(document, i18n)
      response.header('content-type', 'application/pdf')
      response.header(
        'content-disposition',
        `inline; filename="documento-${document.number.replace('/', '-')}.pdf"`
      )
      return pdf
    } catch (error) {
      if (!(error instanceof PdfConversionError)) throw error
      logger.warn({ err: error }, 'PDF conversion failed')
      return response.serviceUnavailable(i18n.t('errors.pdfUnavailable'))
    }
  }
}
