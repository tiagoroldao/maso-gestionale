import { test } from '@japa/runner'
import { csvCode, csvText, safeName, unique } from '#services/supplier_invoice_export'

test.group('Supplier Invoice export: CSV cells', () => {
  test('text that Excel would run as a formula stays text', ({ assert }) => {
    assert.equal(csvText('=SUM(A1)'), "'=SUM(A1)")
    assert.equal(csvText('+39 045 123'), "'+39 045 123")
    assert.equal(csvText('-sconto'), "'-sconto")
    assert.equal(csvText('@nome'), "'@nome")
    assert.equal(csvText('\tTab'), "'\tTab")
    // A carriage return also needs the cell quoted
    assert.equal(csvText('\rA'), `"'\rA"`)
    assert.equal(csvText('Rossi S.r.l.'), 'Rossi S.r.l.')
    assert.equal(csvText('a=b'), 'a=b')
  })

  test('separators, quotes and line breaks are quoted', ({ assert }) => {
    assert.equal(csvText('Rossi; Bianchi'), '"Rossi; Bianchi"')
    assert.equal(csvText('Il "Nuovo"'), '"Il ""Nuovo"""')
    assert.equal(csvText('due\nrighe'), '"due\nrighe"')
  })

  test('codes are text formulas: no lost zeros, no dates', ({ assert }) => {
    assert.equal(csvCode('0042'), '="0042"')
    assert.equal(csvCode('1/2026'), '="1/2026"')
    assert.equal(csvCode('3-2026'), '="3-2026"')
    assert.equal(csvCode('IT03456789019'), '="IT03456789019"')
    // A quote inside is doubled in the formula, and the cell quoted for the CSV
    assert.equal(csvCode('A"1'), '"=""A""""1"""')
    assert.equal(csvCode('A;1'), '"=""A;1"""')
  })
})

test.group('Supplier Invoice export: file names in the zip', () => {
  test('no paths, separators or control characters', ({ assert }) => {
    assert.equal(safeName('../../etc/passwd.xml'), '_.._etc_passwd.xml')
    assert.equal(safeName('..\\windows\\a.xml'), '_windows_a.xml')
    assert.equal(safeName('a/b:c*d?e"f<g>h|i.xml'), 'a_b_c_d_e_f_g_h_i.xml')
    assert.equal(safeName('fat\u0000tu\u001fra\u007f.xml'), 'fattura.xml')
    assert.equal(safeName('..'), 'fattura')
  })

  test('no bidi overrides disguising the extension', ({ assert }) => {
    assert.equal(safeName('fattura\u202Elmx.exe'), 'fatturalmx.exe')
    assert.equal(safeName('a\u202A\u202B\u202C\u202D\u2066\u2067\u2068\u2069.xml'), 'a.xml')
  })

  test('no reserved Windows names, trailing dots or spaces', ({ assert }) => {
    assert.equal(safeName('CON.xml'), '_CON.xml')
    assert.equal(safeName('lpt1.xml.p7m'), '_lpt1.xml.p7m')
    assert.equal(safeName('console.xml'), 'console.xml')
    assert.equal(safeName('fattura.xml. . '), 'fattura.xml')
  })

  test('long names are cut to 150 characters, keeping the extension', ({ assert }) => {
    const name = safeName(`${'a'.repeat(300)}.xml.p7m`)
    assert.lengthOf(name, 150)
    assert.isTrue(name.endsWith('a.xml.p7m'))
  })

  test('a repeated name takes -2, -3… within 150 characters', ({ assert }) => {
    const taken = new Set<string>()
    const long = safeName(`${'a'.repeat(300)}.xml.p7m`)
    const names = [1, 2, 3].map(() => unique(`originali/${long}`, taken))
    assert.deepEqual(
      names.map((path) => path.split('/')[1].length),
      [150, 150, 150]
    )
    assert.deepEqual(
      names.map((path) => path.slice(-11)),
      ['aaa.xml.p7m', 'a-2.xml.p7m', 'a-3.xml.p7m']
    )
    assert.equal(unique('pdf/Fattura.pdf', new Set(['pdf/fattura.pdf'])), 'pdf/Fattura-2.pdf')
  })
})
