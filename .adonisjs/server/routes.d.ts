import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'setup.create': { paramsTuple?: []; params?: {} }
    'setup.store': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'company_settings.logo': { paramsTuple?: []; params?: {} }
    'users.index': { paramsTuple?: []; params?: {} }
    'users.create': { paramsTuple?: []; params?: {} }
    'users.store': { paramsTuple?: []; params?: {} }
    'users.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.deactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.reactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.index': { paramsTuple?: []; params?: {} }
    'customers.create': { paramsTuple?: []; params?: {} }
    'customers.store': { paramsTuple?: []; params?: {} }
    'customers.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'company_settings.edit': { paramsTuple?: []; params?: {} }
    'company_settings.update': { paramsTuple?: []; params?: {} }
    'letterhead_preview.show': { paramsTuple?: []; params?: {} }
    'letterhead_preview.pdf': { paramsTuple?: []; params?: {} }
    'payment_terms.index': { paramsTuple?: []; params?: {} }
    'payment_terms.store': { paramsTuple?: []; params?: {} }
    'payment_terms.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'payment_terms.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'instance': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'setup.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'company_settings.logo': { paramsTuple?: []; params?: {} }
    'users.index': { paramsTuple?: []; params?: {} }
    'users.create': { paramsTuple?: []; params?: {} }
    'users.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.index': { paramsTuple?: []; params?: {} }
    'customers.create': { paramsTuple?: []; params?: {} }
    'customers.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'company_settings.edit': { paramsTuple?: []; params?: {} }
    'letterhead_preview.show': { paramsTuple?: []; params?: {} }
    'letterhead_preview.pdf': { paramsTuple?: []; params?: {} }
    'payment_terms.index': { paramsTuple?: []; params?: {} }
    'instance': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'setup.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'company_settings.logo': { paramsTuple?: []; params?: {} }
    'users.index': { paramsTuple?: []; params?: {} }
    'users.create': { paramsTuple?: []; params?: {} }
    'users.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.index': { paramsTuple?: []; params?: {} }
    'customers.create': { paramsTuple?: []; params?: {} }
    'customers.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'company_settings.edit': { paramsTuple?: []; params?: {} }
    'letterhead_preview.show': { paramsTuple?: []; params?: {} }
    'letterhead_preview.pdf': { paramsTuple?: []; params?: {} }
    'payment_terms.index': { paramsTuple?: []; params?: {} }
    'instance': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'setup.store': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'users.store': { paramsTuple?: []; params?: {} }
    'users.deactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.reactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.store': { paramsTuple?: []; params?: {} }
    'company_settings.update': { paramsTuple?: []; params?: {} }
    'payment_terms.store': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'customers.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'payment_terms.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'payment_terms.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}