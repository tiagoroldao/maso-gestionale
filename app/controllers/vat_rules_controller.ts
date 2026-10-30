import db from '@adonisjs/lucid/services/db'
import VatCode from '#models/vat_code'
import VatRule from '#models/vat_rule'
import { vatRulesValidator } from '#validators/vat_rule'
import { declareActions } from '#shared/screen_actions'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * The Admin's default VAT rules (Settings → Regole IVA): which VAT Code a
 * new line of a Job's Quote or Invoice gets (ADR 0008). Seeded for the
 * commercialista to review; existing lines never change.
 */
export default class VatRulesController {
  async index({ inertia, i18n }: HttpContext) {
    const rules = await VatRule.query().orderBy('id')
    const used = rules.map((rule) => rule.vatCodeId)
    const codes = await VatCode.query()
      .where((q) => q.withScopes((scopes) => scopes.active()).orWhereIn('id', used))
      .orderBy([
        { column: 'rate', order: 'desc' },
        { column: 'name', order: 'asc' },
      ])

    return inertia.render('settings/vat_rules', {
      // The rules are one form: Save submits it (docs/ui.md "Actions")
      actions: declareActions([
        {
          name: 'save',
          label: i18n.t('ui.vatRules.save'),
          rank: 'primary',
          kind: 'submit',
          form: 'vat-rules',
        },
      ]),
      rules: rules.map((rule) => ({
        id: rule.id,
        customerType: rule.customerType,
        workCategory: rule.workCategory,
        residential: rule.residential,
        lineKind: rule.lineKind,
        vatCodeId: rule.vatCodeId,
      })),
      vatCodes: codes.map((code) => ({
        id: code.id,
        name: code.name,
        archived: code.archivedAt !== null,
      })),
    })
  }

  async update({ request, response, session, i18n }: HttpContext) {
    const { rules } = await request.validateUsing(vatRulesValidator)

    await db.transaction(async (trx) => {
      for (const rule of rules) {
        await VatRule.query({ client: trx })
          .where('id', rule.id)
          .update({ vat_code_id: rule.vatCodeId, updated_at: new Date() })
      }
    })

    session.flash('success', i18n.t('flash.vatRulesSaved'))
    response.redirect().toRoute('vat_rules.index')
  }
}
