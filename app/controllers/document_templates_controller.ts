import { DateTime } from 'luxon'
import CompanySettings from '#models/company_settings'
import Customer from '#models/customer'
import DocumentTemplate from '#models/document_template'
import DocumentRenderer from '#documents/document_renderer'
import DocumentTemplates, { TemplateArchivedError } from '#services/document_templates'
import TemplateData, { TemplateDataError } from '#services/template_data'
import { isUniqueViolation } from '#services/database_errors'
import WorkReports from '#services/work_reports'
import { formatDate, todayIso } from '#shared/dates'
import {
  renderTemplateBody,
  sampleTables,
  sampleValues,
  type TemplateNode,
} from '#shared/document_templates'
import { sampleWorkReport } from '#shared/work_report'
import {
  documentTemplateFillValidator,
  documentTemplatePreviewValidator,
  documentTemplateValidator,
} from '#validators/document_template'
import { declareActions, saveActions, type ScreenActionInput } from '#shared/screen_actions'
import { urlFor } from '@adonisjs/core/services/url_builder'
import type { HttpContext } from '@adonisjs/core/http'
import type { I18n } from '@adonisjs/i18n'
import type { Infer } from '@vinejs/vine/types'

// The body rule has checked it is a template document
function toInput(data: Infer<typeof documentTemplateValidator>) {
  return { name: data.name, fields: data.fields, body: data.body as TemplateNode }
}

/** The id of the editor's form, which the header's Save submits */
const TEMPLATE_FORM = 'document-template'

/**
 * A saved template's actions (docs/ui.md "Actions"): Save, trying it with
 * real data, and archiving it, after confirming; an archived one can't be
 * edited, so Restore takes Save's place.
 */
function templateActions(template: DocumentTemplate, i18n: I18n) {
  const params = { id: template.id }
  const archived = template.archivedAt !== null
  const actions: ScreenActionInput[] = [
    archived
      ? {
          name: 'restore',
          label: i18n.t('ui.archive.restore'),
          rank: 'primary',
          kind: 'post',
          href: urlFor('document_templates.restore', params),
        }
      : {
          name: 'save',
          label: i18n.t('ui.documentTemplates.save'),
          rank: 'primary',
          kind: 'submit',
          form: TEMPLATE_FORM,
        },
    {
      name: 'tryWithData',
      label: i18n.t('ui.documentTemplates.tryWithData'),
      rank: 'secondary',
      kind: 'link',
      href: urlFor('document_templates.fill', params),
    },
  ]
  if (!archived) {
    actions.push({
      name: 'archive',
      label: i18n.t('ui.archive.archive'),
      rank: 'overflow',
      kind: 'post',
      href: urlFor('document_templates.archive', params),
      destructive: true,
      confirm: i18n.t('ui.documentTemplates.archiveConfirm'),
    })
  }
  return declareActions(actions)
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
      .withAggregate('versions', (versions) => versions.max('created_at').as('savedAt'))
      .orderBy('name')

    const archived = await DocumentTemplate.query().whereNotNull('archived_at').orderBy('name')

    return inertia.render('settings/document_templates/index', {
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        version: Number(template.$extras.latest),
        // When the latest version was saved
        savedAt: DateTime.fromJSDate(template.$extras.savedAt).toISODate()!,
      })),
      archived: archived.map((template) => ({ id: template.id, name: template.name })),
    })
  }

  async create({ inertia, i18n }: HttpContext) {
    return inertia.render('settings/document_templates/edit', {
      actions: saveActions(i18n.t('ui.documentTemplates.save'), TEMPLATE_FORM),
      template: null,
    })
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

  async edit({ params, inertia, i18n }: HttpContext) {
    const template = await DocumentTemplate.findOrFail(params.id)
    const current = await DocumentTemplates.current(template)

    return inertia.render('settings/document_templates/edit', {
      actions: templateActions(template, i18n),
      template: {
        id: template.id,
        name: template.name,
        version: current.version,
        body: current.body,
        fields: current.fields,
        archived: template.archivedAt !== null,
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
      if (error instanceof TemplateArchivedError) {
        session.flash('error', i18n.t('flash.documentTemplateArchivedNoEdit'))
      } else if (isUniqueViolation(error)) {
        session.flash('error', i18n.t('flash.alreadyTaken'))
      } else {
        throw error
      }
    }
    response.redirect().toRoute('document_templates.edit', { id: template.id })
  }

  /**
   * Templates are archived, never deleted: Issued Documents refer to them.
   * An archived one can't be issued or edited, and keeps its name (names
   * stay unique, so restoring never clashes).
   */
  async archive({ params, response, session, i18n }: HttpContext) {
    const template = await DocumentTemplate.findOrFail(params.id)
    // The update waits for any issue holding the template (IssuedDocuments)
    template.archivedAt = DateTime.now()
    await template.save()

    session.flash('success', i18n.t('flash.documentTemplateArchived', { name: template.name }))
    response.redirect().toRoute('document_templates.index')
  }

  async restore({ params, response, session, i18n }: HttpContext) {
    const template = await DocumentTemplate.findOrFail(params.id)
    template.archivedAt = null
    await template.save()

    session.flash('success', i18n.t('flash.documentTemplateRestored', { name: template.name }))
    response.redirect().toRoute('document_templates.edit', { id: template.id })
  }

  /**
   * The editor's unsaved template filled with sample data, as the Base
   * Layout prints it: HTML for the page's sandboxed preview frame.
   */
  async preview({ request, i18n }: HttpContext) {
    const data = await request.validateUsing(documentTemplatePreviewValidator)
    const settings = await CompanySettings.current()
    const today = formatDate(todayIso())
    const values = sampleValues(data.fields, {
      companyName: settings.name ?? '',
      today,
      workReportPeriod: WorkReports.period({ from: todayIso(), to: todayIso() }, i18n),
    })
    const html = await new DocumentRenderer().renderHtml({
      title: data.name ?? '',
      recipient: {
        name: values['recipient.name'],
        addressLines: ['Via Roma 1', '20121 Milano (MI)'],
      },
      bodyHtml: renderTemplateBody(
        data.body as TemplateNode,
        values,
        sampleTables(data.fields, {
          today,
          workReport: sampleWorkReport(WorkReports.labels(i18n), todayIso()),
        })
      ),
    })
    return { html }
  }

  /**
   * "Try with real data": the saved template's fields to fill for a
   * Customer, as Issued Documents do (#31).
   */
  async fill({ params, inertia }: HttpContext) {
    const template = await DocumentTemplate.findOrFail(params.id)
    const current = await DocumentTemplates.current(template)

    return inertia.render('settings/document_templates/fill', {
      template: { id: template.id, name: current.name, fields: current.fields },
    })
  }

  /**
   * The saved template filled with real data, as the Base Layout prints
   * it; or, by field key, what doesn't fit (`customerId` for the
   * Customer). Nothing is stored.
   */
  async fillPreview({ params, request, response, i18n }: HttpContext) {
    const template = await DocumentTemplate.findOrFail(params.id)
    const current = await DocumentTemplates.current(template)
    const data = await request.validateUsing(documentTemplateFillValidator)
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
      const { values, tables, recipient } = await TemplateData.resolve(
        current.fields,
        customer,
        data.values ?? {},
        i18n
      )
      const html = await new DocumentRenderer().renderHtml({
        title: current.name,
        recipient,
        bodyHtml: renderTemplateBody(current.body, values, tables),
      })
      return { html }
    } catch (error) {
      if (!(error instanceof TemplateDataError)) throw error
      return response.unprocessableEntity({ errors: error.errors })
    }
  }
}
