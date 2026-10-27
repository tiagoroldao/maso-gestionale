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
