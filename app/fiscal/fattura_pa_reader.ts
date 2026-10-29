import * as asn1js from 'asn1js'
import Big from 'big.js'
import { DateTime } from 'luxon'
import { XMLParser } from 'fast-xml-parser'

/**
 * Reads received FatturaPA files (Supplier Invoices): the XML itself, or
 * a CAdES-signed `.p7m` around it. Only the signed content is extracted;
 * the signature isn't verified (SDI checked it before delivering the
 * file, and the Agenzia delle Entrate portal serves files SDI accepted).
 */

/**
 * Why a file can't be read: not a FatturaPA 1.2 invoice or missing what
 * an invoice needs (`unreadable`), a FatturaPA of another kind, such as
 * the simplified FSM10 (`unsupported`), or a `.p7m` whose signed content
 * can't be extracted (`signature`).
 */
export type FatturaReadRefusal = 'unreadable' | 'unsupported' | 'signature'

export class FatturaReadError extends Error {
  constructor(
    readonly reason: FatturaReadRefusal,
    detail: string
  ) {
    super(detail)
  }
}

export type ReceivedAddress = {
  street: string
  streetNumber: string | null
  postalCode: string
  city: string
  province: string | null
  country: string
}

/** The seller (CedentePrestatore): the Supplier */
export type ReceivedSupplier = {
  name: string
  vatCountry: string
  vatNumber: string
  taxCode: string | null
  address: ReceivedAddress | null
  email: string | null
  phone: string | null
}

/** The buyer (CessionarioCommittente): the business, if sent to the right one */
export type ReceivedBuyer = {
  name: string
  vatNumber: string | null
  taxCode: string | null
}

export type ReceivedLine = {
  lineNumber: number
  /** The supplier's article code (the first CodiceArticolo), as on Items */
  code: string | null
  description: string
  quantity: string | null
  unit: string | null
  unitPrice: string
  total: string
  vatRate: string
  natura: string | null
}

export type ReceivedVatRow = {
  vatRate: string
  natura: string | null
  taxable: string
  vat: string
  reference: string | null
}

export type ReceivedPayment = {
  method: string
  dueOn: string | null
  amount: string
  iban: string | null
}

/** One invoice of the file (a FatturaElettronicaBody) */
export type ReceivedInvoice = {
  documentType: string
  currency: string
  number: string
  issuedOn: string
  taxable: string
  vat: string
  total: string
  notes: string[]
  lines: ReceivedLine[]
  summary: ReceivedVatRow[]
  payments: ReceivedPayment[]
}

export type ReceivedFattura = {
  version: 'FPR12' | 'FPA12'
  supplier: ReceivedSupplier
  buyer: ReceivedBuyer
  /** Usually one; a file may batch several invoices of one supplier */
  invoices: ReceivedInvoice[]
}

/**
 * The FatturaPA XML of a received file: the file itself, or the content
 * of a signed `.p7m` (DER, or Base64 as some portals serve it).
 */
export function extractXml(contents: Buffer): string {
  const bytes = withoutBom(contents)
  if (!isSigned(contents)) return decode(bytes)
  let content: Buffer = bytes
  // A file signed twice wraps one signature in another
  for (let depth = 0; depth < 3; depth++) {
    content = signedContent(content)
    if (looksLikeXml(withoutBom(content))) return decode(withoutBom(content))
  }
  throw new FatturaReadError('signature', 'The signed content is not XML')
}

/**
 * Whether a received file is signed (.p7m) rather than the XML itself.
 */
export function isSigned(contents: Buffer) {
  return !looksLikeXml(withoutBom(contents))
}

/**
 * Reads a FatturaPA 1.2.x document (FPR12 or FPA12): the supplier, the
 * buyer, and each invoice's header, lines, VAT summary and payments.
 * Amounts stay decimal strings (ADR 0007).
 */
export function readFatturaPA(xml: string): ReceivedFattura {
  // No document type declarations: nothing in FatturaPA needs one
  if (/<!DOCTYPE/i.test(xml)) throw new FatturaReadError('unreadable', 'DOCTYPE not allowed')
  let parsed: Record<string, unknown>
  try {
    parsed = parser.parse(xml, true)
  } catch (error) {
    throw new FatturaReadError('unreadable', `Not well-formed XML: ${(error as Error).message}`)
  }
  const root = parsed.FatturaElettronica as Element | undefined
  if (!root || typeof root !== 'object') {
    throw new FatturaReadError('unreadable', 'No FatturaElettronica element')
  }
  const version = text(root, '@_versione')
  if (version !== 'FPR12' && version !== 'FPA12') {
    throw new FatturaReadError('unsupported', `Version ${version ?? 'missing'}`)
  }
  const header = element(root, 'FatturaElettronicaHeader')
  const bodies = elements(root, 'FatturaElettronicaBody')
  if (!bodies.length) throw new FatturaReadError('unreadable', 'No FatturaElettronicaBody')
  return {
    version,
    supplier: supplierOf(element(header, 'CedentePrestatore')),
    buyer: buyerOf(element(header, 'CessionarioCommittente')),
    invoices: bodies.map(invoiceOf),
  }
}

type Element = Record<string, unknown>

/** Elements that may repeat, always read as arrays */
const REPEATED = new Set([
  'FatturaElettronicaBody',
  'DettaglioLinee',
  'DatiRiepilogo',
  'DatiPagamento',
  'DettaglioPagamento',
  'CodiceArticolo',
  'Causale',
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Character references (&#232;, &#xE8;) are decoded, as every XML reader does
  htmlEntities: true,
  isArray: (name) => REPEATED.has(name),
})

function withoutBom(bytes: Buffer) {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
}

function looksLikeXml(bytes: Buffer) {
  return bytes.subarray(0, 64).toString('latin1').trimStart().startsWith('<')
}

/**
 * Decodes XML in the encoding its declaration names (FatturaPA files are
 * UTF-8 or ISO-8859-1, sometimes Windows-1252); UTF-8 by default.
 */
function decode(bytes: Buffer) {
  const declaration = bytes.subarray(0, 200).toString('latin1')
  const declared = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(declaration)?.[1]
  try {
    return new TextDecoder(declared ?? 'utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new FatturaReadError('unreadable', `Can't decode as ${declared ?? 'utf-8'}`)
  }
}

const SIGNED_DATA = '1.2.840.113549.1.7.2'

/**
 * The content a CMS SignedData (`.p7m`) carries: ContentInfo →
 * SignedData → encapContentInfo → eContent, its OCTET STRING possibly
 * split in chunks (BER).
 */
function signedContent(bytes: Buffer): Buffer {
  try {
    return unwrapSignedData(bytes)
  } catch (error) {
    // asn1js throws on some malformed input instead of reporting it
    if (error instanceof FatturaReadError) throw error
    throw new FatturaReadError('signature', `Unreadable signature: ${(error as Error).message}`)
  }
}

function unwrapSignedData(bytes: Buffer): Buffer {
  const der = isDer(bytes) ? bytes : fromBase64(bytes)
  const refuse = (detail: string): never => {
    throw new FatturaReadError('signature', detail)
  }
  const decoded = asn1js.fromBER(new Uint8Array(der))
  if (decoded.offset === -1) refuse(`Not ASN.1: ${decoded.result.error}`)
  const contentInfo = children(decoded.result)
  const type = contentInfo[0]
  if (!(type instanceof asn1js.ObjectIdentifier) || type.getValue() !== SIGNED_DATA) {
    refuse('Not a CMS SignedData')
  }
  const signedData = children(children(contentInfo[1])[0])
  // version, digestAlgorithms, then encapContentInfo
  const encapsulated = children(signedData[2])
  const eContent = children(encapsulated[1])[0]
  if (!(eContent instanceof asn1js.OctetString)) refuse('Detached signature: no content')
  return Buffer.from((eContent as asn1js.OctetString).getValue())
}

function children(node: asn1js.AsnType | undefined): asn1js.AsnType[] {
  const value = (node as asn1js.Constructed | undefined)?.valueBlock?.value
  if (!Array.isArray(value)) {
    throw new FatturaReadError('signature', 'Unexpected CMS structure')
  }
  return value
}

/** DER starts with a SEQUENCE tag */
function isDer(bytes: Buffer) {
  return bytes[0] === 0x30
}

function fromBase64(bytes: Buffer) {
  const textual = bytes
    .toString('latin1')
    .replace(/-----(BEGIN|END)[^-]*-----/g, '')
    .replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(textual)) {
    throw new FatturaReadError('signature', 'Neither DER nor Base64')
  }
  const decoded = Buffer.from(textual, 'base64')
  if (!isDer(decoded)) throw new FatturaReadError('signature', 'Base64 content is not DER')
  return decoded
}

function element(parent: Element, name: string): Element {
  const value = parent[name]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FatturaReadError('unreadable', `Missing ${name}`)
  }
  return value as Element
}

function optionalElement(parent: Element, name: string): Element | null {
  const value = parent[name]
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Element) : null
}

function elements(parent: Element, name: string): Element[] {
  const value = parent[name]
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : []
}

/** A text value, or null when absent or empty */
function text(parent: Element | null, name: string): string | null {
  const value = parent?.[name]
  if (typeof value === 'string') return value.trim() || null
  // An element with attributes keeps its text under #text
  if (value && typeof value === 'object' && '#text' in value) {
    return String((value as Element)['#text']).trim() || null
  }
  return null
}

function required(parent: Element, name: string, max?: number): string {
  const value = text(parent, name)
  if (value === null) throw new FatturaReadError('unreadable', `Missing ${name}`)
  if (max && value.length > max) throw new FatturaReadError('unreadable', `${name} too long`)
  return value
}

function decimal(value: string, name: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new FatturaReadError('unreadable', `${name} is not a number: ${value}`)
  }
  return new Big(value).toString()
}

function date(value: string, name: string): string {
  const day = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !DateTime.fromISO(day).isValid) {
    throw new FatturaReadError('unreadable', `${name} is not a date: ${value}`)
  }
  return day
}

function nameOf(registry: Element) {
  const company = text(registry, 'Denominazione')
  if (company) return company
  const person = [text(registry, 'Nome'), text(registry, 'Cognome')].filter(Boolean).join(' ')
  if (!person) throw new FatturaReadError('unreadable', 'Missing Anagrafica')
  return person
}

function addressOf(seat: Element | null): ReceivedAddress | null {
  if (!seat) return null
  return {
    street: text(seat, 'Indirizzo') ?? '',
    streetNumber: text(seat, 'NumeroCivico'),
    postalCode: text(seat, 'CAP') ?? '',
    city: text(seat, 'Comune') ?? '',
    province: text(seat, 'Provincia'),
    country: text(seat, 'Nazione') ?? 'IT',
  }
}

function supplierOf(seller: Element): ReceivedSupplier {
  const registry = element(seller, 'DatiAnagrafici')
  const vat = element(registry, 'IdFiscaleIVA')
  const contacts = optionalElement(seller, 'Contatti')
  const vatCountry = required(vat, 'IdPaese').toUpperCase()
  // Letters and digits only, so "IT 0123…" and "IT0123…" are one Supplier
  const vatNumber = required(vat, 'IdCodice', 28)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (!/^[A-Z]{2}$/.test(vatCountry) || !vatNumber) {
    throw new FatturaReadError('unreadable', 'Invalid IdFiscaleIVA')
  }
  return {
    name: nameOf(element(registry, 'Anagrafica')),
    vatCountry,
    vatNumber,
    taxCode: text(registry, 'CodiceFiscale')?.toUpperCase() ?? null,
    address: addressOf(optionalElement(seller, 'Sede')),
    email: text(contacts, 'Email'),
    phone: text(contacts, 'Telefono'),
  }
}

function buyerOf(buyer: Element): ReceivedBuyer {
  const registry = element(buyer, 'DatiAnagrafici')
  return {
    name: nameOf(element(registry, 'Anagrafica')),
    vatNumber: text(optionalElement(registry, 'IdFiscaleIVA'), 'IdCodice')?.toUpperCase() ?? null,
    taxCode: text(registry, 'CodiceFiscale')?.toUpperCase() ?? null,
  }
}

function invoiceOf(body: Element): ReceivedInvoice {
  const general = element(element(body, 'DatiGenerali'), 'DatiGeneraliDocumento')
  const goods = element(body, 'DatiBeniServizi')
  const lines = elements(goods, 'DettaglioLinee').map(lineOf)
  const summary = elements(goods, 'DatiRiepilogo').map(vatRowOf)
  if (!summary.length) throw new FatturaReadError('unreadable', 'Missing DatiRiepilogo')
  const taxable = summary.reduce((sum, row) => sum.plus(row.taxable), new Big(0))
  const vat = summary.reduce((sum, row) => sum.plus(row.vat), new Big(0))
  // The document total is optional: the summary's taxable plus VAT otherwise
  const declared = text(general, 'ImportoTotaleDocumento')
  return {
    documentType: required(general, 'TipoDocumento', 4),
    currency: required(general, 'Divisa', 3),
    number: required(general, 'Numero', 20),
    issuedOn: date(required(general, 'Data'), 'Data'),
    taxable: taxable.toFixed(2),
    vat: vat.toFixed(2),
    total: new Big(
      declared ? decimal(declared, 'ImportoTotaleDocumento') : taxable.plus(vat)
    ).toFixed(2),
    notes: ((general.Causale as unknown[] | undefined) ?? [])
      .map((value) => String(value).trim())
      .filter(Boolean),
    lines,
    summary,
    payments: elements(body, 'DatiPagamento').flatMap((terms) =>
      elements(terms, 'DettaglioPagamento').map(paymentOf)
    ),
  }
}

function lineOf(line: Element): ReceivedLine {
  const quantity = text(line, 'Quantita')
  const codes = elements(line, 'CodiceArticolo')
  return {
    lineNumber: lineNumberOf(required(line, 'NumeroLinea')),
    code: codes.length ? text(codes[0], 'CodiceValore') : null,
    description: required(line, 'Descrizione'),
    quantity: quantity ? decimal(quantity, 'Quantita') : null,
    unit: text(line, 'UnitaMisura'),
    unitPrice: decimal(required(line, 'PrezzoUnitario'), 'PrezzoUnitario'),
    total: decimal(required(line, 'PrezzoTotale'), 'PrezzoTotale'),
    vatRate: decimal(required(line, 'AliquotaIVA'), 'AliquotaIVA'),
    natura: text(line, 'Natura'),
  }
}

/** NumeroLinea: a whole number, at most 4 digits */
function lineNumberOf(value: string) {
  if (!/^\d{1,4}$/.test(value)) {
    throw new FatturaReadError('unreadable', `NumeroLinea is not a line number: ${value}`)
  }
  return Number(value)
}

function vatRowOf(row: Element): ReceivedVatRow {
  return {
    vatRate: decimal(required(row, 'AliquotaIVA'), 'AliquotaIVA'),
    natura: text(row, 'Natura'),
    taxable: decimal(required(row, 'ImponibileImporto'), 'ImponibileImporto'),
    vat: decimal(required(row, 'Imposta'), 'Imposta'),
    reference: text(row, 'RiferimentoNormativo'),
  }
}

function paymentOf(payment: Element): ReceivedPayment {
  const due = text(payment, 'DataScadenzaPagamento')
  return {
    method: required(payment, 'ModalitaPagamento'),
    dueOn: due ? date(due, 'DataScadenzaPagamento') : null,
    amount: decimal(required(payment, 'ImportoPagamento'), 'ImportoPagamento'),
    iban: text(payment, 'IBAN'),
  }
}
