import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import { validateXML } from 'xmllint-wasm'

const SCHEMA = 'Schema_del_file_xml_FatturaPA_v1.2.2.xsd'
const SIGNATURE = 'xmldsig-core-schema.xsd'

/**
 * Validates FatturaPA XML against the official schema vendored in
 * resources/fatturapa; returns the validation errors (none when valid).
 */
export async function fatturaSchemaErrors(xml: string) {
  const read = (name: string) => readFile(app.makePath('resources/fatturapa', name), 'utf8')
  const result = await validateXML({
    xml: [{ fileName: 'fattura.xml', contents: xml }],
    schema: [{ fileName: SCHEMA, contents: await read(SCHEMA) }],
    preload: [{ fileName: SIGNATURE, contents: await read(SIGNATURE) }],
  })
  return result.errors.map((error) => error.rawMessage)
}
