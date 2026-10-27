/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractRawResponse, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'setup.create': {
    methods: ["GET","HEAD"]
    pattern: '/setup'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/setup_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/setup_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/setup_controller').default['create']>>>
    }
  }
  'setup.store': {
    methods: ["POST"]
    pattern: '/setup'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').setupValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').setupValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/setup_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/setup_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/setup_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'session.create': {
    methods: ["GET","HEAD"]
    pattern: '/login'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
    }
  }
  'session.store': {
    methods: ["POST"]
    pattern: '/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'session.destroy': {
    methods: ["POST"]
    pattern: '/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
    }
  }
  'dashboard': {
    methods: ["GET","HEAD"]
    pattern: '/dashboard'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
      rawResponse: ExtractRawResponse<unknown>
    }
  }
  'company_settings.logo': {
    methods: ["GET","HEAD"]
    pattern: '/company/logo'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/company_settings_controller').default['logo']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/company_settings_controller').default['logo']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/company_settings_controller').default['logo']>>>
    }
  }
  'items.search': {
    methods: ["GET","HEAD"]
    pattern: '/items/search'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/item').itemSearchValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['search']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['search']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['search']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'users.index': {
    methods: ["GET","HEAD"]
    pattern: '/users'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/users_controller').default['index']>>>
    }
  }
  'users.create': {
    methods: ["GET","HEAD"]
    pattern: '/users/create'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/users_controller').default['create']>>>
    }
  }
  'users.store': {
    methods: ["POST"]
    pattern: '/users'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').createUserValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').createUserValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/users_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'users.edit': {
    methods: ["GET","HEAD"]
    pattern: '/users/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/users_controller').default['edit']>>>
    }
  }
  'users.update': {
    methods: ["PUT"]
    pattern: '/users/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').updateUserValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/user').updateUserValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/users_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'users.deactivate': {
    methods: ["POST"]
    pattern: '/users/:id/deactivate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['deactivate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['deactivate']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/users_controller').default['deactivate']>>>
    }
  }
  'users.reactivate': {
    methods: ["POST"]
    pattern: '/users/:id/reactivate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['reactivate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['reactivate']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/users_controller').default['reactivate']>>>
    }
  }
  'customers.index': {
    methods: ["GET","HEAD"]
    pattern: '/customers'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/customer').customerSearchValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'customers.create': {
    methods: ["GET","HEAD"]
    pattern: '/customers/create'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['create']>>>
    }
  }
  'customers.store': {
    methods: ["POST"]
    pattern: '/customers'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/customer').customerValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/customer').customerValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'customers.show': {
    methods: ["GET","HEAD"]
    pattern: '/customers/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['show']>>>
    }
  }
  'customers.edit': {
    methods: ["GET","HEAD"]
    pattern: '/customers/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['edit']>>>
    }
  }
  'customers.update': {
    methods: ["PUT"]
    pattern: '/customers/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/customer').customerValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/customer').customerValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'customer_sites.store': {
    methods: ["POST"]
    pattern: '/customers/:customerId/sites'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/site').linkSiteValidator)>>
      paramsTuple: [ParamValue]
      params: { customerId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/site').linkSiteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customer_sites_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customer_sites_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customer_sites_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'customer_sites.destroy': {
    methods: ["DELETE"]
    pattern: '/customers/:customerId/sites/:siteId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { customerId: ParamValue; siteId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customer_sites_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customer_sites_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customer_sites_controller').default['destroy']>>>
    }
  }
  'sites.index': {
    methods: ["GET","HEAD"]
    pattern: '/sites'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/site').siteSearchValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'sites.search': {
    methods: ["GET","HEAD"]
    pattern: '/sites/search'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/site').siteSearchValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['search']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['search']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['search']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'sites.create': {
    methods: ["GET","HEAD"]
    pattern: '/sites/create'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['create']>>>
    }
  }
  'sites.store': {
    methods: ["POST"]
    pattern: '/sites'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/site').siteValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/site').siteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'sites.show': {
    methods: ["GET","HEAD"]
    pattern: '/sites/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['show']>>>
    }
  }
  'sites.edit': {
    methods: ["GET","HEAD"]
    pattern: '/sites/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['edit']>>>
    }
  }
  'sites.update': {
    methods: ["PUT"]
    pattern: '/sites/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/site').siteValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/site').siteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'installed_equipment.create': {
    methods: ["GET","HEAD"]
    pattern: '/sites/:siteId/equipment/create'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { siteId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['create']>>>
    }
  }
  'installed_equipment.store': {
    methods: ["POST"]
    pattern: '/sites/:siteId/equipment'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/installed_equipment').installedEquipmentValidator)>>
      paramsTuple: [ParamValue]
      params: { siteId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/installed_equipment').installedEquipmentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'installed_equipment.edit': {
    methods: ["GET","HEAD"]
    pattern: '/equipment/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['edit']>>>
    }
  }
  'installed_equipment.update': {
    methods: ["PUT"]
    pattern: '/equipment/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/installed_equipment').installedEquipmentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/installed_equipment').installedEquipmentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'items.index': {
    methods: ["GET","HEAD"]
    pattern: '/items'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/item').itemSearchValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'items.create': {
    methods: ["GET","HEAD"]
    pattern: '/items/create'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['create']>>>
    }
  }
  'items.store': {
    methods: ["POST"]
    pattern: '/items'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/item').itemValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/item').itemValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'items.show': {
    methods: ["GET","HEAD"]
    pattern: '/items/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['show']>>>
    }
  }
  'stock_movements.receive': {
    methods: ["POST"]
    pattern: '/items/:id/receipts'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/stock').receiptValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/stock').receiptValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/stock_movements_controller').default['receive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/stock_movements_controller').default['receive']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/stock_movements_controller').default['receive']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'stock_movements.adjust': {
    methods: ["POST"]
    pattern: '/items/:id/adjustments'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/stock').adjustmentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/stock').adjustmentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/stock_movements_controller').default['adjust']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/stock_movements_controller').default['adjust']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/stock_movements_controller').default['adjust']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'stock.index': {
    methods: ["GET","HEAD"]
    pattern: '/stock'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/stock_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/stock_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/stock_controller').default['index']>>>
    }
  }
  'items.edit': {
    methods: ["GET","HEAD"]
    pattern: '/items/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['edit']>>>
    }
  }
  'items.update': {
    methods: ["PUT"]
    pattern: '/items/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/item').itemValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/item').itemValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'items.archive': {
    methods: ["POST"]
    pattern: '/items/:id/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['archive']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['archive']>>>
    }
  }
  'items.unarchive': {
    methods: ["POST"]
    pattern: '/items/:id/unarchive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['unarchive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['unarchive']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['unarchive']>>>
    }
  }
  'items.destroy': {
    methods: ["DELETE"]
    pattern: '/items/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/items_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/items_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/items_controller').default['destroy']>>>
    }
  }
  'categories.index': {
    methods: ["GET","HEAD"]
    pattern: '/settings/categories'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['index']>>>
    }
  }
  'categories.store': {
    methods: ["POST"]
    pattern: '/settings/categories'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/item').categoryValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/item').categoryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'categories.update': {
    methods: ["PUT"]
    pattern: '/settings/categories/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/item').categoryValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/item').categoryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'categories.destroy': {
    methods: ["DELETE"]
    pattern: '/settings/categories/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/categories_controller').default['destroy']>>>
    }
  }
  'company_settings.edit': {
    methods: ["GET","HEAD"]
    pattern: '/settings/company'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/company_settings_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/company_settings_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/company_settings_controller').default['edit']>>>
    }
  }
  'company_settings.update': {
    methods: ["POST"]
    pattern: '/settings/company'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/company_settings').companySettingsValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/company_settings').companySettingsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/company_settings_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/company_settings_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/company_settings_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'letterhead_preview.show': {
    methods: ["GET","HEAD"]
    pattern: '/settings/company/letterhead'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/letterhead_preview_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/letterhead_preview_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/letterhead_preview_controller').default['show']>>>
    }
  }
  'letterhead_preview.pdf': {
    methods: ["GET","HEAD"]
    pattern: '/settings/company/letterhead.pdf'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/letterhead_preview_controller').default['pdf']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/letterhead_preview_controller').default['pdf']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/letterhead_preview_controller').default['pdf']>>>
    }
  }
  'payment_terms.index': {
    methods: ["GET","HEAD"]
    pattern: '/settings/payment-terms'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['index']>>>
    }
  }
  'payment_terms.store': {
    methods: ["POST"]
    pattern: '/settings/payment-terms'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/payment_terms').paymentTermsValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/payment_terms').paymentTermsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'payment_terms.update': {
    methods: ["PUT"]
    pattern: '/settings/payment-terms/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/payment_terms').paymentTermsValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/payment_terms').paymentTermsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'payment_terms.destroy': {
    methods: ["DELETE"]
    pattern: '/settings/payment-terms/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/payment_terms_controller').default['destroy']>>>
    }
  }
  'instance': {
    methods: ["GET","HEAD"]
    pattern: '/instance'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
      rawResponse: ExtractRawResponse<unknown>
    }
  }
}
