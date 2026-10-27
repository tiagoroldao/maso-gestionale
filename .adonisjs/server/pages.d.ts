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
    'installed_equipment/form': ExtractProps<(typeof import('../../inertia/pages/installed_equipment/form.vue'))['default']>
    'instance': ExtractProps<(typeof import('../../inertia/pages/instance.vue'))['default']>
    'items/form': ExtractProps<(typeof import('../../inertia/pages/items/form.vue'))['default']>
    'items/index': ExtractProps<(typeof import('../../inertia/pages/items/index.vue'))['default']>
    'settings/categories': ExtractProps<(typeof import('../../inertia/pages/settings/categories.vue'))['default']>
    'settings/company': ExtractProps<(typeof import('../../inertia/pages/settings/company.vue'))['default']>
    'settings/payment_terms': ExtractProps<(typeof import('../../inertia/pages/settings/payment_terms.vue'))['default']>
    'setup': ExtractProps<(typeof import('../../inertia/pages/setup.vue'))['default']>
    'sites/form': ExtractProps<(typeof import('../../inertia/pages/sites/form.vue'))['default']>
    'sites/index': ExtractProps<(typeof import('../../inertia/pages/sites/index.vue'))['default']>
    'sites/show': ExtractProps<(typeof import('../../inertia/pages/sites/show.vue'))['default']>
    'users/create': ExtractProps<(typeof import('../../inertia/pages/users/create.vue'))['default']>
    'users/edit': ExtractProps<(typeof import('../../inertia/pages/users/edit.vue'))['default']>
    'users/index': ExtractProps<(typeof import('../../inertia/pages/users/index.vue'))['default']>
  }
}
