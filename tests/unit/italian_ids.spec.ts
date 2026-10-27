import { test } from '@japa/runner'
import { isValidItalianIban, isValidTaxCode, isValidVatNumber } from '#fiscal/italian_ids'

test.group('Italian identifiers', () => {
  test('Partita IVA {$self}')
    .with(['12345678903', '01114601006', '00743110157'])
    .run(({ assert }, value) => assert.isTrue(isValidVatNumber(value)))

  test('rejects Partita IVA {$self}')
    .with(['12345678901', '1234567890', '1234567890A', ''])
    .run(({ assert }, value) => assert.isFalse(isValidVatNumber(value)))

  test('Codice Fiscale {$self}')
    .with(['RSSMRA85T10A562S', 'MRTMTT25D09F205Z', '12345678903'])
    .run(({ assert }, value) => assert.isTrue(isValidTaxCode(value)))

  test('rejects Codice Fiscale {$self}')
    .with(['RSSMRA85T10A562X', 'RSSMRA85T10A562', '12345678901', 'rssmra85t10a562s'])
    .run(({ assert }, value) => assert.isFalse(isValidTaxCode(value)))

  test('IBAN {$self}')
    .with(['IT60X0542811101000000123456'])
    .run(({ assert }, value) => assert.isTrue(isValidItalianIban(value)))

  test('rejects IBAN {$self}')
    .with(['IT60X0542811101000000123457', 'DE89370400440532013000', 'IT60X054281110100000012345'])
    .run(({ assert }, value) => assert.isFalse(isValidItalianIban(value)))
})
