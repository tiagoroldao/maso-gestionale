import {
  Building2,
  CalendarClock,
  FileText,
  Hash,
  ListChecks,
  Percent,
  Tags,
  Wrench,
} from 'lucide-vue-next'
import { t } from '~/i18n'
import type { NavItem } from '~/components/nav_link.vue'

/**
 * The pages of the settings area (Impostazioni), in the order its menu
 * lists them. The first, the company's details, is the area's home: the
 * main menu's Impostazioni opens it, and the others sit under it.
 */
export const SETTINGS_PAGES: NavItem[] = [
  { label: t('ui.settings.company'), route: 'company_settings.edit', icon: Building2 },
  { label: t('ui.settings.paymentTerms'), route: 'payment_terms.index', icon: CalendarClock },
  { label: t('ui.settings.categories'), route: 'categories.index', icon: Tags },
  { label: t('ui.settings.rates'), route: 'rates.index', icon: Wrench },
  { label: t('ui.settings.vatCodes'), route: 'vat_codes.index', icon: Percent },
  { label: t('ui.settings.vatRules'), route: 'vat_rules.index', icon: ListChecks },
  {
    label: t('ui.settings.documentTemplates'),
    route: 'document_templates.index',
    icon: FileText,
  },
  { label: t('ui.settings.invoiceNumbering'), route: 'invoice_numbering.index', icon: Hash },
]
