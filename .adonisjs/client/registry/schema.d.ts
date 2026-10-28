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
  'visit_photos.show': {
    methods: ["GET","HEAD"]
    pattern: '/visit-photos/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/visit_photos_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/visit_photos_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/visit_photos_controller').default['show']>>>
    }
  }
  'my_visits.show': {
    methods: ["GET","HEAD"]
    pattern: '/my-visits/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['show']>>>
    }
  }
  'my_visits.update_status': {
    methods: ["POST"]
    pattern: '/my-visits/:id/status'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/field').visitStatusValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/field').visitStatusValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['updateStatus']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['updateStatus']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['updateStatus']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'my_visits.add_note': {
    methods: ["POST"]
    pattern: '/my-visits/:id/notes'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/field').visitNoteValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/field').visitNoteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addNote']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addNote']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addNote']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'my_visits.add_photo': {
    methods: ["POST"]
    pattern: '/my-visits/:id/photos'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/field').visitPhotoValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/field').visitPhotoValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addPhoto']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addPhoto']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addPhoto']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'my_visits.add_hours': {
    methods: ["POST"]
    pattern: '/my-visits/:id/hours'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/field').visitHoursValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/field').visitHoursValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addHours']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addHours']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addHours']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'my_visits.remove_hours': {
    methods: ["DELETE"]
    pattern: '/visit-hours/:hourId'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { hourId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['removeHours']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['removeHours']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['removeHours']>>>
    }
  }
  'my_visits.add_item': {
    methods: ["POST"]
    pattern: '/my-visits/:id/items'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/field').visitItemValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/field').visitItemValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addItem']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addItem']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['addItem']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'my_visits.set_serviced': {
    methods: ["POST"]
    pattern: '/my-visits/:id/serviced'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/field').servicedEquipmentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/field').servicedEquipmentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['setServiced']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['setServiced']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['setServiced']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'my_visits.remove_item': {
    methods: ["DELETE"]
    pattern: '/visit-items/:itemId'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { itemId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['removeItem']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['removeItem']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['removeItem']>>>
    }
  }
  'item_documents.show': {
    methods: ["GET","HEAD"]
    pattern: '/item-documents/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/item_documents_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/item_documents_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/item_documents_controller').default['show']>>>
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
  'customers.search': {
    methods: ["GET","HEAD"]
    pattern: '/customers/search'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/job').customerPickerValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['search']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['search']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['search']>>> | { status: 422; response: { errors: SimpleError[] } }
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
  'customers.archive': {
    methods: ["POST"]
    pattern: '/customers/:id/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['archive']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['archive']>>>
    }
  }
  'customers.restore': {
    methods: ["POST"]
    pattern: '/customers/:id/restore'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['restore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['restore']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/customers_controller').default['restore']>>>
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
  'sites.archive': {
    methods: ["POST"]
    pattern: '/sites/:id/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['archive']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['archive']>>>
    }
  }
  'sites.restore': {
    methods: ["POST"]
    pattern: '/sites/:id/restore'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['restore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['restore']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/sites_controller').default['restore']>>>
    }
  }
  'installed_equipment.remove': {
    methods: ["POST"]
    pattern: '/equipment/:id/remove'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/installed_equipment').removeEquipmentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/installed_equipment').removeEquipmentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['remove']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['remove']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['remove']>>> | { status: 422; response: { errors: SimpleError[] } }
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
      body: ExtractBody<InferInput<(typeof import('#validators/installed_equipment').updateInstalledEquipmentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/installed_equipment').updateInstalledEquipmentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/installed_equipment_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'my_visits.index': {
    methods: ["GET","HEAD"]
    pattern: '/my-visits'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/my_visits_controller').default['index']>>>
    }
  }
  'jobs.index': {
    methods: ["GET","HEAD"]
    pattern: '/jobs'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/job').jobSearchValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'jobs.create': {
    methods: ["GET","HEAD"]
    pattern: '/jobs/create'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['create']>>>
    }
  }
  'jobs.store': {
    methods: ["POST"]
    pattern: '/jobs'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/job').jobValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/job').jobValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'jobs.show': {
    methods: ["GET","HEAD"]
    pattern: '/jobs/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['show']>>>
    }
  }
  'jobs.edit': {
    methods: ["GET","HEAD"]
    pattern: '/jobs/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['edit']>>>
    }
  }
  'jobs.update': {
    methods: ["PUT"]
    pattern: '/jobs/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/job').jobValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/job').jobValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'jobs.cancel': {
    methods: ["POST"]
    pattern: '/jobs/:id/cancel'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['cancel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['cancel']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['cancel']>>>
    }
  }
  'visits.create': {
    methods: ["GET","HEAD"]
    pattern: '/jobs/:id/visits/create'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['create']>>>
    }
  }
  'visits.store': {
    methods: ["POST"]
    pattern: '/jobs/:id/visits'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/visit').visitValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/visit').visitValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'visits.schedule': {
    methods: ["GET","HEAD"]
    pattern: '/agenda'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/visit').scheduleValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['schedule']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['schedule']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['schedule']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'visits.to_schedule': {
    methods: ["GET","HEAD"]
    pattern: '/agenda/to-schedule'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['toSchedule']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['toSchedule']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['toSchedule']>>>
    }
  }
  'visits.move': {
    methods: ["PATCH"]
    pattern: '/visits/:id/move'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/visit').moveVisitValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/visit').moveVisitValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['move']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['move']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['move']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'visits.edit': {
    methods: ["GET","HEAD"]
    pattern: '/visits/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['edit']>>>
    }
  }
  'visits.update': {
    methods: ["PUT"]
    pattern: '/visits/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/visit').editVisitValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/visit').editVisitValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'visits.destroy': {
    methods: ["DELETE"]
    pattern: '/visits/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/visits_controller').default['destroy']>>>
    }
  }
  'quotes.edit': {
    methods: ["GET","HEAD"]
    pattern: '/jobs/:id/quote'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['edit']>>>
    }
  }
  'quotes.update': {
    methods: ["PUT"]
    pattern: '/jobs/:id/quote'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/quote').quoteValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/quote').quoteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'quotes.accept': {
    methods: ["POST"]
    pattern: '/jobs/:id/quote/accept'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['accept']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['accept']>>>
    }
  }
  'quotes.decline': {
    methods: ["POST"]
    pattern: '/jobs/:id/quote/decline'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['decline']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['decline']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['decline']>>>
    }
  }
  'quotes.pdf': {
    methods: ["GET","HEAD"]
    pattern: '/jobs/:id/quote.pdf'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['pdf']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['pdf']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['pdf']>>>
    }
  }
  'invoices.index': {
    methods: ["GET","HEAD"]
    pattern: '/invoices'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/invoice').invoiceStageValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'invoices.create': {
    methods: ["GET","HEAD"]
    pattern: '/invoices/create'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['create']>>>
    }
  }
  'invoices.store': {
    methods: ["POST"]
    pattern: '/invoices'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invoice').newInvoiceValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/invoice').newInvoiceValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'invoices.store_from_job': {
    methods: ["POST"]
    pattern: '/jobs/:id/invoices'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['storeFromJob']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['storeFromJob']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['storeFromJob']>>>
    }
  }
  'invoices.edit': {
    methods: ["GET","HEAD"]
    pattern: '/invoices/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['edit']>>>
    }
  }
  'invoices.update': {
    methods: ["PUT"]
    pattern: '/invoices/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invoice').invoiceValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/invoice').invoiceValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'invoices.destroy': {
    methods: ["DELETE"]
    pattern: '/invoices/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['destroy']>>>
    }
  }
  'invoices.finalise': {
    methods: ["POST"]
    pattern: '/invoices/:id/finalise'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['finalise']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['finalise']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['finalise']>>>
    }
  }
  'invoices.pdf': {
    methods: ["GET","HEAD"]
    pattern: '/invoices/:id/pdf'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['pdf']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['pdf']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['pdf']>>>
    }
  }
  'invoices.xml': {
    methods: ["GET","HEAD"]
    pattern: '/invoices/:id/xml'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['xml']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['xml']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['xml']>>>
    }
  }
  'invoices.submission_xml': {
    methods: ["GET","HEAD"]
    pattern: '/invoices/:id/submissions/:submissionId/xml'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; submissionId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['submissionXml']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['submissionXml']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['submissionXml']>>>
    }
  }
  'invoices.record_payment': {
    methods: ["POST"]
    pattern: '/invoices/:id/payments'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invoice').paymentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/invoice').paymentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['recordPayment']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['recordPayment']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['recordPayment']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'invoices.remove_payment': {
    methods: ["DELETE"]
    pattern: '/payments/:paymentId'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { paymentId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['removePayment']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['removePayment']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['removePayment']>>>
    }
  }
  'invoices.prepare_submission': {
    methods: ["POST"]
    pattern: '/invoices/:id/submissions'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['prepareSubmission']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['prepareSubmission']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['prepareSubmission']>>>
    }
  }
  'invoices.confirm_submission': {
    methods: ["POST"]
    pattern: '/invoices/:id/submissions/confirm'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['confirmSubmission']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['confirmSubmission']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['confirmSubmission']>>>
    }
  }
  'invoices.record_outcome': {
    methods: ["POST"]
    pattern: '/invoices/:id/submissions/outcome'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invoice').submissionOutcomeValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/invoice').submissionOutcomeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['recordOutcome']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['recordOutcome']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoices_controller').default['recordOutcome']>>> | { status: 422; response: { errors: SimpleError[] } }
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
  'item_documents.store': {
    methods: ["POST"]
    pattern: '/items/:id/documents'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/item_document').itemDocumentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/item_document').itemDocumentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/item_documents_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/item_documents_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/item_documents_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'item_documents.destroy': {
    methods: ["DELETE"]
    pattern: '/item-documents/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/item_documents_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/item_documents_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/item_documents_controller').default['destroy']>>>
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
  'rates.index': {
    methods: ["GET","HEAD"]
    pattern: '/settings/rates'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['index']>>>
    }
  }
  'rates.store': {
    methods: ["POST"]
    pattern: '/settings/rates'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/quote').labourRateValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/quote').labourRateValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'rates.update': {
    methods: ["PUT"]
    pattern: '/settings/rates/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/quote').labourRateValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/quote').labourRateValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'rates.archive': {
    methods: ["POST"]
    pattern: '/settings/rates/:id/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['archive']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['archive']>>>
    }
  }
  'rates.update_call_out_fee': {
    methods: ["PUT"]
    pattern: '/settings/call-out-fee'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/quote').callOutFeeValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/quote').callOutFeeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['updateCallOutFee']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['updateCallOutFee']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/rates_controller').default['updateCallOutFee']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vat_codes.index': {
    methods: ["GET","HEAD"]
    pattern: '/settings/vat-codes'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['index']>>>
    }
  }
  'vat_codes.store': {
    methods: ["POST"]
    pattern: '/settings/vat-codes'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vat_code').vatCodeValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/vat_code').vatCodeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vat_codes.update': {
    methods: ["PUT"]
    pattern: '/settings/vat-codes/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vat_code').vatCodeValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/vat_code').vatCodeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'vat_codes.archive': {
    methods: ["POST"]
    pattern: '/settings/vat-codes/:id/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['archive']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/vat_codes_controller').default['archive']>>>
    }
  }
  'vat_rules.index': {
    methods: ["GET","HEAD"]
    pattern: '/settings/vat-rules'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vat_rules_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vat_rules_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/vat_rules_controller').default['index']>>>
    }
  }
  'vat_rules.update': {
    methods: ["PUT"]
    pattern: '/settings/vat-rules'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/vat_rule').vatRulesValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/vat_rule').vatRulesValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/vat_rules_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/vat_rules_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/vat_rules_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'invoice_numbering.index': {
    methods: ["GET","HEAD"]
    pattern: '/settings/invoice-numbering'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoice_numbering_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoice_numbering_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoice_numbering_controller').default['index']>>>
    }
  }
  'invoice_numbering.update_sdi_prefix': {
    methods: ["PUT"]
    pattern: '/settings/invoice-numbering/sdi-prefix'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invoice').sdiPrefixValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/invoice').sdiPrefixValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoice_numbering_controller').default['updateSdiPrefix']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoice_numbering_controller').default['updateSdiPrefix']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoice_numbering_controller').default['updateSdiPrefix']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'invoice_numbering.update': {
    methods: ["PUT"]
    pattern: '/settings/invoice-numbering/:year'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/invoice').invoiceNumberingValidator)>>
      paramsTuple: [ParamValue]
      params: { year: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/invoice').invoiceNumberingValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invoice_numbering_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invoice_numbering_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/invoice_numbering_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
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
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/instance_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/instance_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/instance_controller').default['show']>>>
    }
  }
  'instance.update': {
    methods: ["PUT"]
    pattern: '/instance'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/instance_settings').instanceSettingsValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/instance_settings').instanceSettingsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/instance_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/instance_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/instance_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'instance.admin_password': {
    methods: ["PUT"]
    pattern: '/instance/admins/:id/password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/instance_settings').adminPasswordValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/instance_settings').adminPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/instance_controller').default['setAdminPassword']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/instance_controller').default['setAdminPassword']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/instance_controller').default['setAdminPassword']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
}
