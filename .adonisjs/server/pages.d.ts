import '@adonisjs/inertia/types'

import type { VNodeProps, AllowedComponentProps, ComponentInstance } from 'vue'

type ExtractProps<T> = Omit<
  ComponentInstance<T>['$props'],
  keyof VNodeProps | keyof AllowedComponentProps
>

declare module '@adonisjs/inertia/types' {
  export interface InertiaPages {
    'auth/login': ExtractProps<(typeof import('../../inertia/pages/auth/login.vue'))['default']>
    'customers/form': ExtractProps<(typeof import('../../inertia/pages/customers/form.vue'))['default']>
    'customers/index': ExtractProps<(typeof import('../../inertia/pages/customers/index.vue'))['default']>
    'customers/show': ExtractProps<(typeof import('../../inertia/pages/customers/show.vue'))['default']>
    'dashboard': ExtractProps<(typeof import('../../inertia/pages/dashboard.vue'))['default']>
    'errors/forbidden': ExtractProps<(typeof import('../../inertia/pages/errors/forbidden.vue'))['default']>
    'errors/not_found': ExtractProps<(typeof import('../../inertia/pages/errors/not_found.vue'))['default']>
    'errors/server_error': ExtractProps<(typeof import('../../inertia/pages/errors/server_error.vue'))['default']>
    'field/index': ExtractProps<(typeof import('../../inertia/pages/field/index.vue'))['default']>
    'field/show': ExtractProps<(typeof import('../../inertia/pages/field/show.vue'))['default']>
    'installed_equipment/form': ExtractProps<(typeof import('../../inertia/pages/installed_equipment/form.vue'))['default']>
    'instance': ExtractProps<(typeof import('../../inertia/pages/instance.vue'))['default']>
    'invoices/create': ExtractProps<(typeof import('../../inertia/pages/invoices/create.vue'))['default']>
    'invoices/edit': ExtractProps<(typeof import('../../inertia/pages/invoices/edit.vue'))['default']>
    'invoices/index': ExtractProps<(typeof import('../../inertia/pages/invoices/index.vue'))['default']>
    'items/form': ExtractProps<(typeof import('../../inertia/pages/items/form.vue'))['default']>
    'items/index': ExtractProps<(typeof import('../../inertia/pages/items/index.vue'))['default']>
    'items/show': ExtractProps<(typeof import('../../inertia/pages/items/show.vue'))['default']>
    'jobs/form': ExtractProps<(typeof import('../../inertia/pages/jobs/form.vue'))['default']>
    'jobs/index': ExtractProps<(typeof import('../../inertia/pages/jobs/index.vue'))['default']>
    'jobs/show': ExtractProps<(typeof import('../../inertia/pages/jobs/show.vue'))['default']>
    'quotes/edit': ExtractProps<(typeof import('../../inertia/pages/quotes/edit.vue'))['default']>
    'settings/categories': ExtractProps<(typeof import('../../inertia/pages/settings/categories.vue'))['default']>
    'settings/company': ExtractProps<(typeof import('../../inertia/pages/settings/company.vue'))['default']>
    'settings/invoice_numbering': ExtractProps<(typeof import('../../inertia/pages/settings/invoice_numbering.vue'))['default']>
    'settings/payment_terms': ExtractProps<(typeof import('../../inertia/pages/settings/payment_terms.vue'))['default']>
    'settings/rates': ExtractProps<(typeof import('../../inertia/pages/settings/rates.vue'))['default']>
    'settings/vat_codes': ExtractProps<(typeof import('../../inertia/pages/settings/vat_codes.vue'))['default']>
    'settings/vat_rules': ExtractProps<(typeof import('../../inertia/pages/settings/vat_rules.vue'))['default']>
    'setup': ExtractProps<(typeof import('../../inertia/pages/setup.vue'))['default']>
    'sites/form': ExtractProps<(typeof import('../../inertia/pages/sites/form.vue'))['default']>
    'sites/index': ExtractProps<(typeof import('../../inertia/pages/sites/index.vue'))['default']>
    'sites/show': ExtractProps<(typeof import('../../inertia/pages/sites/show.vue'))['default']>
    'stock/index': ExtractProps<(typeof import('../../inertia/pages/stock/index.vue'))['default']>
    'users/create': ExtractProps<(typeof import('../../inertia/pages/users/create.vue'))['default']>
    'users/edit': ExtractProps<(typeof import('../../inertia/pages/users/edit.vue'))['default']>
    'users/index': ExtractProps<(typeof import('../../inertia/pages/users/index.vue'))['default']>
    'visits/create': ExtractProps<(typeof import('../../inertia/pages/visits/create.vue'))['default']>
    'visits/schedule': ExtractProps<(typeof import('../../inertia/pages/visits/schedule.vue'))['default']>
    'visits/to_schedule': ExtractProps<(typeof import('../../inertia/pages/visits/to_schedule.vue'))['default']>
  }
}
