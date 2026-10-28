import CompanySettings from '#models/company_settings'
import DocumentTemplate from '#models/document_template'
import DocumentRenderer from '#documents/document_renderer'
import DocumentTemplates from '#services/document_templates'
import { isUniqueViolation } from '#services/database_errors'
import { formatDate, todayIso } from '#shared/dates'
import { renderTemplateBody, sampleValues, type TemplateNode } from '#shared/document_templates'
import {
  documentTemplatePreviewValidator,
  documentTemplateValidator,
} from '#validators/document_template'
import type { HttpContext } from '@adonisjs/core/http'
import type { Infer } from '@vinejs/vine/types'

// The body rule has checked it is a template document
function toInput(data: Infer<typeof documentTemplateValidator>) {
  return { name: data.name, fields: data.fields, body: data.body as TemplateNode }
}

/**
 * The Admin's Document Templates (Settings → Modelli di documento): a
 * rich-text body with placeholders, inside the fixed Base Layout.
 */
export default class DocumentTemplatesController {
  async index({ inertia }: HttpContext) {
    const templates = await DocumentTemplate.query()
      .withScopes((scopes) => scopes.active())
      .withAggregate('versions', (versions) => versions.max('version').as('latest'))
      .orderBy('name')

    return inertia.render('settings/document_templates/index', {
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        version: Number(template.$extras.latest),
        updatedAt: (template.updatedAt ?? template.createdAt).toISODate()!,
      })),
    })
  }

  async create({ inertia }: HttpContext) {
    return inertia.render('settings/document_templates/edit', { template: null })
  }

  async store({ request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(documentTemplateValidator)
    try {
      const template = await DocumentTemplates.create(toInput(data), auth.getUserOrFail())
      session.flash('success', i18n.t('flash.documentTemplateSaved', { version: 1 }))
      return response.redirect().toRoute('document_templates.edit', { id: template.id })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
      return response.redirect().back()
    }
  }

  async edit({ params, inertia }: HttpContext) {
    const template = await DocumentTemplate.findOrFail(params.id)
    const current = await DocumentTemplates.current(template)

    return inertia.render('settings/document_templates/edit', {
      template: {
        id: template.id,
        name: template.name,
        version: current.version,
        body: current.body,
        fields: current.fields,
      },
    })
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const template = await DocumentTemplate.findOrFail(params.id)
    const data = await request.validateUsing(documentTemplateValidator)
    try {
      const version = await DocumentTemplates.save(template, toInput(data), auth.getUserOrFail())
      session.flash('success', i18n.t('flash.documentTemplateSaved', { version: version.version }))
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      session.flash('error', i18n.t('flash.alreadyTaken'))
    }
    response.redirect().toRoute('document_templates.edit', { id: template.id })
  }

  /**
   * The editor's unsaved template filled with sample data, as the Base
   * Layout prints it: HTML for the page's sandboxed preview frame.
   */
  async preview({ request }: HttpContext) {
    const data = await request.validateUsing(documentTemplatePreviewValidator)
    const settings = await CompanySettings.current()
    const values = sampleValues(data.fields, {
      companyName: settings.name ?? '',
      today: formatDate(todayIso()),
    })
    const html = await new DocumentRenderer().renderHtml({
      title: data.name ?? '',
      recipient: {
        name: values['recipient.name'],
        addressLines: ['Via Roma 1', '20121 Milano (MI)'],
      },
      bodyHtml: renderTemplateBody(data.body as TemplateNode, values),
    })
    return { html }
  }
}
