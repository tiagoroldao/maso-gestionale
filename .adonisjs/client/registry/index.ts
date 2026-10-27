/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'setup.create': {
    methods: ["GET","HEAD"],
    pattern: '/setup',
    tokens: [[0,"setup"]],
    types: placeholder as Registry['setup.create']['types'],
  },
  'setup.store': {
    methods: ["POST"],
    pattern: '/setup',
    tokens: [[0,"setup"]],
    types: placeholder as Registry['setup.store']['types'],
  },
  'session.create': {
    methods: ["GET","HEAD"],
    pattern: '/login',
    tokens: [[0,"login"]],
    types: placeholder as Registry['session.create']['types'],
  },
  'session.store': {
    methods: ["POST"],
    pattern: '/login',
    tokens: [[0,"login"]],
    types: placeholder as Registry['session.store']['types'],
  },
  'session.destroy': {
    methods: ["POST"],
    pattern: '/logout',
    tokens: [[0,"logout"]],
    types: placeholder as Registry['session.destroy']['types'],
  },
  'dashboard': {
    methods: ["GET","HEAD"],
    pattern: '/dashboard',
    tokens: [[0,"dashboard"]],
    types: placeholder as Registry['dashboard']['types'],
  },
  'company_settings.logo': {
    methods: ["GET","HEAD"],
    pattern: '/company/logo',
    tokens: [[0,"company"],[0,"logo"]],
    types: placeholder as Registry['company_settings.logo']['types'],
  },
  'users.index': {
    methods: ["GET","HEAD"],
    pattern: '/users',
    tokens: [[0,"users"]],
    types: placeholder as Registry['users.index']['types'],
  },
  'users.create': {
    methods: ["GET","HEAD"],
    pattern: '/users/create',
    tokens: [[0,"users"],[0,"create"]],
    types: placeholder as Registry['users.create']['types'],
  },
  'users.store': {
    methods: ["POST"],
    pattern: '/users',
    tokens: [[0,"users"]],
    types: placeholder as Registry['users.store']['types'],
  },
  'users.edit': {
    methods: ["GET","HEAD"],
    pattern: '/users/:id/edit',
    tokens: [[0,"users"],[1,"id"],[0,"edit"]],
    types: placeholder as Registry['users.edit']['types'],
  },
  'users.update': {
    methods: ["PUT"],
    pattern: '/users/:id',
    tokens: [[0,"users"],[1,"id"]],
    types: placeholder as Registry['users.update']['types'],
  },
  'users.deactivate': {
    methods: ["POST"],
    pattern: '/users/:id/deactivate',
    tokens: [[0,"users"],[1,"id"],[0,"deactivate"]],
    types: placeholder as Registry['users.deactivate']['types'],
  },
  'users.reactivate': {
    methods: ["POST"],
    pattern: '/users/:id/reactivate',
    tokens: [[0,"users"],[1,"id"],[0,"reactivate"]],
    types: placeholder as Registry['users.reactivate']['types'],
  },
  'customers.index': {
    methods: ["GET","HEAD"],
    pattern: '/customers',
    tokens: [[0,"customers"]],
    types: placeholder as Registry['customers.index']['types'],
  },
  'customers.create': {
    methods: ["GET","HEAD"],
    pattern: '/customers/create',
    tokens: [[0,"customers"],[0,"create"]],
    types: placeholder as Registry['customers.create']['types'],
  },
  'customers.store': {
    methods: ["POST"],
    pattern: '/customers',
    tokens: [[0,"customers"]],
    types: placeholder as Registry['customers.store']['types'],
  },
  'customers.show': {
    methods: ["GET","HEAD"],
    pattern: '/customers/:id',
    tokens: [[0,"customers"],[1,"id"]],
    types: placeholder as Registry['customers.show']['types'],
  },
  'customers.edit': {
    methods: ["GET","HEAD"],
    pattern: '/customers/:id/edit',
    tokens: [[0,"customers"],[1,"id"],[0,"edit"]],
    types: placeholder as Registry['customers.edit']['types'],
  },
  'customers.update': {
    methods: ["PUT"],
    pattern: '/customers/:id',
    tokens: [[0,"customers"],[1,"id"]],
    types: placeholder as Registry['customers.update']['types'],
  },
  'customer_sites.store': {
    methods: ["POST"],
    pattern: '/customers/:customerId/sites',
    tokens: [[0,"customers"],[1,"customerId"],[0,"sites"]],
    types: placeholder as Registry['customer_sites.store']['types'],
  },
  'customer_sites.destroy': {
    methods: ["DELETE"],
    pattern: '/customers/:customerId/sites/:siteId',
    tokens: [[0,"customers"],[1,"customerId"],[0,"sites"],[1,"siteId"]],
    types: placeholder as Registry['customer_sites.destroy']['types'],
  },
  'sites.index': {
    methods: ["GET","HEAD"],
    pattern: '/sites',
    tokens: [[0,"sites"]],
    types: placeholder as Registry['sites.index']['types'],
  },
  'sites.search': {
    methods: ["GET","HEAD"],
    pattern: '/sites/search',
    tokens: [[0,"sites"],[0,"search"]],
    types: placeholder as Registry['sites.search']['types'],
  },
  'sites.create': {
    methods: ["GET","HEAD"],
    pattern: '/sites/create',
    tokens: [[0,"sites"],[0,"create"]],
    types: placeholder as Registry['sites.create']['types'],
  },
  'sites.store': {
    methods: ["POST"],
    pattern: '/sites',
    tokens: [[0,"sites"]],
    types: placeholder as Registry['sites.store']['types'],
  },
  'sites.edit': {
    methods: ["GET","HEAD"],
    pattern: '/sites/:id/edit',
    tokens: [[0,"sites"],[1,"id"],[0,"edit"]],
    types: placeholder as Registry['sites.edit']['types'],
  },
  'sites.update': {
    methods: ["PUT"],
    pattern: '/sites/:id',
    tokens: [[0,"sites"],[1,"id"]],
    types: placeholder as Registry['sites.update']['types'],
  },
  'company_settings.edit': {
    methods: ["GET","HEAD"],
    pattern: '/settings/company',
    tokens: [[0,"settings"],[0,"company"]],
    types: placeholder as Registry['company_settings.edit']['types'],
  },
  'company_settings.update': {
    methods: ["POST"],
    pattern: '/settings/company',
    tokens: [[0,"settings"],[0,"company"]],
    types: placeholder as Registry['company_settings.update']['types'],
  },
  'letterhead_preview.show': {
    methods: ["GET","HEAD"],
    pattern: '/settings/company/letterhead',
    tokens: [[0,"settings"],[0,"company"],[0,"letterhead"]],
    types: placeholder as Registry['letterhead_preview.show']['types'],
  },
  'letterhead_preview.pdf': {
    methods: ["GET","HEAD"],
    pattern: '/settings/company/letterhead.pdf',
    tokens: [[0,"settings"],[0,"company"],[0,"letterhead.pdf"]],
    types: placeholder as Registry['letterhead_preview.pdf']['types'],
  },
  'payment_terms.index': {
    methods: ["GET","HEAD"],
    pattern: '/settings/payment-terms',
    tokens: [[0,"settings"],[0,"payment-terms"]],
    types: placeholder as Registry['payment_terms.index']['types'],
  },
  'payment_terms.store': {
    methods: ["POST"],
    pattern: '/settings/payment-terms',
    tokens: [[0,"settings"],[0,"payment-terms"]],
    types: placeholder as Registry['payment_terms.store']['types'],
  },
  'payment_terms.update': {
    methods: ["PUT"],
    pattern: '/settings/payment-terms/:id',
    tokens: [[0,"settings"],[0,"payment-terms"],[1,"id"]],
    types: placeholder as Registry['payment_terms.update']['types'],
  },
  'payment_terms.destroy': {
    methods: ["DELETE"],
    pattern: '/settings/payment-terms/:id',
    tokens: [[0,"settings"],[0,"payment-terms"],[1,"id"]],
    types: placeholder as Registry['payment_terms.destroy']['types'],
  },
  'instance': {
    methods: ["GET","HEAD"],
    pattern: '/instance',
    tokens: [[0,"instance"]],
    types: placeholder as Registry['instance']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
