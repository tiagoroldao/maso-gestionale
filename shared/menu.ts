/**
 * The app menu (docs/ui.md "Menu"): grouped by area, Impostazioni last,
 * each item listed for the roles that can open its screen. The server
 * enforces access; this only hides what a role can't use, and
 * `tests/functional/menu.spec.ts` checks every item opens for its roles.
 */

export type MenuRole = 'superuser' | 'admin' | 'office' | 'technician'

export type MenuItem = {
  /** Catalogue key of the item's name */
  label: string
  /** Name of the route the item opens */
  route: string
  /** Path prefix under which the item stays marked active, when wider than its route's */
  section?: string
  roles: readonly MenuRole[]
}

export type MenuGroup = {
  /** Catalogue key of the group's name */
  label: string
  items: readonly MenuItem[]
}

const STAFF = ['admin', 'office'] as const

export const MENU: readonly MenuGroup[] = [
  {
    label: 'ui.nav.groups.work',
    items: [
      { label: 'ui.nav.dashboard', route: 'dashboard', roles: STAFF },
      { label: 'ui.nav.jobs', route: 'jobs.index', roles: STAFF },
      { label: 'ui.nav.schedule', route: 'visits.schedule', roles: STAFF },
      { label: 'ui.nav.myVisits', route: 'my_visits.index', roles: ['technician'] },
    ],
  },
  {
    label: 'ui.nav.groups.billing',
    items: [
      { label: 'ui.nav.invoices', route: 'invoices.index', roles: STAFF },
      { label: 'ui.nav.supplierInvoices', route: 'supplier_invoices.index', roles: STAFF },
    ],
  },
  {
    label: 'ui.nav.groups.warehouse',
    items: [
      { label: 'ui.nav.items', route: 'items.index', roles: STAFF },
      { label: 'ui.nav.stock', route: 'stock.index', roles: STAFF },
      { label: 'ui.nav.suppliers', route: 'suppliers.index', roles: STAFF },
    ],
  },
  {
    label: 'ui.nav.groups.records',
    items: [
      { label: 'ui.nav.customers', route: 'customers.index', roles: STAFF },
      { label: 'ui.nav.sites', route: 'sites.index', roles: STAFF },
    ],
  },
  {
    label: 'ui.nav.groups.settings',
    items: [
      {
        label: 'ui.nav.settings',
        route: 'company_settings.edit',
        section: '/settings',
        roles: ['admin'],
      },
      { label: 'ui.nav.users', route: 'users.index', roles: ['admin'] },
      { label: 'ui.nav.instance', route: 'instance', roles: ['superuser'] },
    ],
  },
]

/** The menu a role sees: its items only, and only groups left with any. */
export function menuFor(role: string | undefined): MenuGroup[] {
  return MENU.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.some((itemRole) => itemRole === role)),
  })).filter((group) => group.items.length > 0)
}
