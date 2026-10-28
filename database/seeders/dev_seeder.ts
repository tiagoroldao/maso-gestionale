import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Category from '#models/category'
import CompanySettings from '#models/company_settings'
import Customer from '#models/customer'
import InstalledEquipment from '#models/installed_equipment'
import Item from '#models/item'
import Job, { type JobKind } from '#models/job'
import LabourRate from '#models/labour_rate'
import PaymentTerms from '#models/payment_terms'
import Site from '#models/site'
import User from '#models/user'
import VatCode from '#models/vat_code'
import FieldWork from '#services/field_work'
import InstanceSetup from '#services/instance_setup'
import Invoices from '#services/invoices'
import Quotes from '#services/quotes'
import Scheduling from '#services/scheduling'
import { nextJobSequence } from '#services/job_numbers'
import StockLedger from '#stock/stock_ledger'
import type { WorkCategory } from '#shared/jobs'

/**
 * Logins created by the seeder, printed when it finishes and listed in
 * the README.
 */
export const DEV_PASSWORD = 'password123'
export const DEV_LOGINS = {
  superuser: 'superuser@maso.test',
  admin: 'titolare@maso.test',
  office: 'ufficio@maso.test',
  technicians: ['luca@maso.test', 'giorgio@maso.test'],
}

/**
 * A small plumbing business in a believable state, for trying the app:
 * every role, a stocked catalogue, one Customer of each type, Jobs in
 * every status and Visits around today. Built through the app's services
 * so stock, statuses and price snapshots follow the real rules.
 * Run with `npm run dev:reset`; never in production.
 */
export default class DevSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    if (app.inProduction) throw new Error('The development seeder never runs in production')

    const { admin } = await InstanceSetup.run({
      superuser: { email: DEV_LOGINS.superuser, password: DEV_PASSWORD },
      admin: { fullName: 'Paolo Maso', email: DEV_LOGINS.admin, password: DEV_PASSWORD },
    })
    await User.create({
      fullName: 'Francesca Ufficio',
      email: DEV_LOGINS.office,
      password: DEV_PASSWORD,
      role: 'office',
    })
    // One at a time: queries in parallel on one transaction warn in tests
    const technicians: User[] = []
    for (const [i, fullName] of ['Luca Ferri', 'Giorgio Sala'].entries()) {
      technicians.push(
        await User.create({
          fullName,
          email: DEV_LOGINS.technicians[i],
          password: DEV_PASSWORD,
          role: 'technician',
        })
      )
    }
    const [luca, giorgio] = technicians

    await this.settings()
    const rates = await this.rates()
    const items = await this.catalogue(admin)
    const customers = await this.customers()

    const today = DateTime.now().startOf('day')
    const at = (day: DateTime, hour: number) => day.set({ hour })

    const standard = await VatCode.findByOrFail('name', '22%')
    const reduced = await VatCode.findByOrFail('name', '10%')
    const reverseCharge = await VatCode.findByOrFail('natura', 'N6.7')

    // Open: just phoned in, nothing planned yet
    await this.job(customers.private, 'quoted', 'maintenance', 'Perdita sotto il lavello')

    // Quoted: a draft Quote waiting for the Customer
    const quoted = await this.job(
      customers.condominium,
      'quoted',
      'renovation',
      'Rifacimento colonna montante'
    )
    await Quotes.save(quoted, {
      notes: 'Validità 30 giorni.',
      lines: [
        {
          kind: 'item',
          itemId: items.tubo.id,
          description: items.tubo.description,
          quantity: '24',
          unitPrice: items.tubo.resalePrice,
          vatCodeId: reduced.id,
        },
        {
          kind: 'labour',
          labourRateId: rates.idraulico.id,
          description: rates.idraulico.name,
          quantity: '16',
          unitPrice: rates.idraulico.hourlyPrice,
          vatCodeId: reduced.id,
        },
        { kind: 'text', description: 'Opere murarie escluse.' },
      ],
    })

    // Accepted: the Quote is signed, the work isn't planned yet
    const accepted = await this.job(
      customers.company,
      'quoted',
      'new_installation',
      'Nuovi bagni uffici'
    )
    await Quotes.save(accepted, {
      lines: [
        {
          kind: 'item',
          itemId: items.wc.id,
          description: items.wc.description,
          quantity: '2',
          unitPrice: items.wc.resalePrice,
          vatCodeId: reverseCharge.id,
        },
        {
          kind: 'labour',
          labourRateId: rates.idraulico.id,
          description: rates.idraulico.name,
          quantity: '12',
          unitPrice: rates.idraulico.hourlyPrice,
          vatCodeId: reverseCharge.id,
        },
      ],
    })
    await Quotes.accept(accepted)

    // In progress: a boiler swap, one Visit started today, one tomorrow
    const boiler = await this.job(
      customers.private,
      'time_and_materials',
      'maintenance',
      'Sostituzione caldaia'
    )
    const started = await Scheduling.plan(boiler, {
      startsAt: at(today, 9),
      endsAt: at(today, 13),
      technicianIds: [luca.id, giorgio.id],
      notes: 'Portare il kit fumi da 60/100.',
    })
    await FieldWork.setStatus(started, 'in_progress', luca)
    await FieldWork.recordHours(started, {
      technicianId: luca.id,
      labourRateId: rates.idraulico.id,
      hours: '2',
    })
    await Scheduling.plan(boiler, {
      startsAt: at(today.plus({ days: 1 }), 14),
      endsAt: at(today.plus({ days: 1 }), 16),
      technicianIds: [luca.id],
      notes: 'Prima accensione e collaudo.',
    })

    // Work complete: a repair done two days ago, with hours and Items used
    const repair = await this.job(
      customers.organisation,
      'time_and_materials',
      'repair',
      'Riparazione scarico spogliatoi'
    )
    const done = await Scheduling.plan(repair, {
      startsAt: at(today.minus({ days: 2 }), 8),
      endsAt: at(today.minus({ days: 2 }), 12),
      technicianIds: [giorgio.id],
    })
    await FieldWork.recordHours(done, {
      technicianId: giorgio.id,
      labourRateId: rates.idraulico.id,
      hours: '3.5',
    })
    await FieldWork.recordItem(done, { itemId: items.sifone.id, quantity: '2' })
    await FieldWork.recordItem(done, { itemId: items.raccordo.id, quantity: '6' })
    await FieldWork.setStatus(done, 'done', giorgio)

    // Needs another visit: a part was missing; shows in "Da ripianificare"
    const leak = await this.job(
      customers.company,
      'time_and_materials',
      'repair',
      'Perdita impianto antincendio'
    )
    const blocked = await Scheduling.plan(leak, {
      startsAt: at(today.minus({ days: 1 }), 15),
      endsAt: at(today.minus({ days: 1 }), 17),
      technicianIds: [luca.id],
    })
    await FieldWork.recordHours(blocked, {
      technicianId: luca.id,
      labourRateId: rates.idraulico.id,
      hours: '1.5',
    })
    await blocked.related('fieldNotes').create({
      body: 'Serve una valvola da 2", da ordinare.',
      userId: luca.id,
    })
    await FieldWork.setStatus(blocked, 'needs_return', luca)

    // A planned Visit later this week, and a cancelled Job
    const service = await this.job(
      customers.condominium,
      'time_and_materials',
      'maintenance',
      'Manutenzione annuale centrale termica'
    )
    await Scheduling.plan(service, {
      startsAt: at(today.plus({ days: 3 }), 10),
      endsAt: at(today.plus({ days: 3 }), 12),
      technicianIds: [giorgio.id],
    })
    const cancelled = await this.job(customers.private, 'quoted', 'sale', 'Preventivo addolcitore')
    cancelled.merge({ status: 'cancelled', cancelledAt: DateTime.now() })
    await cancelled.save()

    // A draft Invoice at two rates with a global discount: gaskets bought
    // at the counter (22%) and maintenance at the Customer's home (10%)
    const invoice = await Invoices.create(customers.private.customer)
    await Invoices.save(invoice, {
      discountPercent: '5',
      notes: 'Materiale al banco e manutenzione a domicilio.',
      lines: [
        {
          itemId: items.guarnizioni.id,
          description: items.guarnizioni.description,
          quantity: '2',
          unitPrice: items.guarnizioni.resalePrice,
          vatCodeId: standard.id,
        },
        {
          description: 'Manutenzione rubinetteria, Casa Rossi',
          quantity: '1',
          unitPrice: '60',
          vatCodeId: reduced.id,
        },
      ],
    })

    this.report()
  }

  private async settings() {
    const settings = await CompanySettings.current()
    settings.merge({
      name: 'Idraulica Maso S.r.l.',
      vatNumber: '01987654322',
      taxCode: '01987654322',
      taxRegime: 'RF01',
      street: 'Via dei Mille',
      streetNumber: '12',
      postalCode: '20121',
      city: 'Milano',
      province: 'MI',
      iban: 'IT60X0542811101000000123456',
      email: 'info@idraulicamaso.example',
      phone: '+39 02 1234567',
      callOutFee: '35',
    })
    await settings.save()
    await PaymentTerms.createMany([
      { name: '30 gg fine mese', days: 30, endOfMonth: true },
      { name: '60 gg data fattura', days: 60, endOfMonth: false },
    ])
  }

  private async rates() {
    const [idraulico, apprendista] = await LabourRate.createMany([
      { name: 'Idraulico', hourlyPrice: '40' },
      { name: 'Apprendista', hourlyPrice: '28' },
    ])
    return { idraulico, apprendista }
  }

  private async catalogue(admin: User) {
    const [raccorderia, sanitari, caldaie] = await Category.createMany([
      { name: 'Raccorderia', markupPercent: '35' },
      { name: 'Sanitari e rubinetteria', markupPercent: '30' },
      { name: 'Caldaie e climatizzazione', markupPercent: '25' },
    ])
    // Sold over the counter, everything is 22%; Jobs take VAT from the work
    const standard = await VatCode.findByOrFail('name', '22%')
    const rows: [string, string, string, Category, string, string, string, Partial<Item>?][] = [
      ['RAC-T12', 'Raccordo a T in ottone 1/2"', 'pz', raccorderia, '1.20', '1.90', '200'],
      ['RAC-G34', 'Gomito in ottone 3/4"', 'pz', raccorderia, '1.65', '2.40', '150'],
      ['TUB-MS20', 'Tubo multistrato 20 mm', 'm', raccorderia, '2.10', '3.20', '300'],
      ['VAL-SF12', 'Valvola a sfera 1/2"', 'pz', raccorderia, '4.80', '7.50', '40'],
      ['SIF-40', 'Sifone per lavabo 40 mm', 'pz', sanitari, '6.00', '9.50', '25'],
      ['RUB-MIX', 'Miscelatore lavabo cromato', 'pz', sanitari, '38.00', '55.00', '8'],
      // Below its reorder level, so the stock list flags it
      [
        'FLX-30',
        'Flessibile inox 30 cm',
        'pz',
        sanitari,
        '2.50',
        '4.00',
        '3',
        { reorderLevel: '20' },
      ],
      [
        'WC-SOSP',
        'Vaso sospeso in ceramica',
        'pz',
        sanitari,
        '120.00',
        '190.00',
        '4',
        { significantGood: true },
      ],
      [
        'CAL-25',
        'Caldaia a condensazione 25 kW',
        'pz',
        caldaie,
        '1150.00',
        '1590.00',
        '2',
        { significantGood: true, maintenanceIntervalMonths: 12 },
      ],
      [
        'CLIM-9',
        'Climatizzatore 9000 BTU',
        'pz',
        caldaie,
        '420.00',
        '650.00',
        '3',
        { significantGood: true, maintenanceIntervalMonths: 12 },
      ],
      ['GUAR-K', 'Kit guarnizioni assortite', 'conf', raccorderia, '5.00', '9.00', '12'],
      ['TEF-12', 'Nastro in teflon 12 mm', 'pz', raccorderia, '0.60', '1.20', '60'],
    ]
    const created = new Map<string, Item>()
    for (const [code, description, unit, category, purchase, resale, stock, extra] of rows) {
      const item = await Item.create({
        code,
        description,
        unit,
        categoryId: category.id,
        supplierName: 'Idrotermica Lombarda S.p.A.',
        purchasePrice: purchase,
        resalePrice: resale,
        vatCodeId: standard.id,
        ...extra,
      })
      await StockLedger.receive(item, {
        quantity: stock,
        unitCost: purchase,
        occurredOn: DateTime.now().minus({ days: 20 }).startOf('day'),
        reference: 'DDT 1043',
        user: admin,
      })
      created.set(code, item)
    }
    const get = (code: string) => created.get(code)!
    return {
      raccordo: get('RAC-T12'),
      tubo: get('TUB-MS20'),
      sifone: get('SIF-40'),
      guarnizioni: get('GUAR-K'),
      wc: get('WC-SOSP'),
      caldaia: get('CAL-25'),
    }
  }

  private async customers() {
    const rimessa = await PaymentTerms.findByOrFail('name', 'Rimessa diretta')
    const fineMese = await PaymentTerms.findByOrFail('name', '30 gg fine mese')
    const address = (street: string, city = 'Milano', province = 'MI', postalCode = '20121') => ({
      street,
      postalCode,
      city,
      province,
    })

    const privateCustomer = await Customer.create({
      type: 'private',
      firstName: 'Mario',
      lastName: 'Rossi',
      taxCode: 'RSSMRA85T10A562S',
      phone: '+39 333 1234567',
      paymentTermsId: rimessa.id,
      ...address('Via Garibaldi'),
      streetNumber: '5',
    })
    const company = await Customer.create({
      type: 'company',
      name: 'Studio Bianchi Architetti S.r.l.',
      vatNumber: '12345678903',
      sdiCode: 'M5UXCR1',
      paymentTermsId: fineMese.id,
      ...address('Corso Buenos Aires', 'Milano'),
      streetNumber: '44',
    })
    const condominium = await Customer.create({
      type: 'condominium',
      name: 'Condominio Via Verdi 10',
      taxCode: '97123450153',
      paymentTermsId: fineMese.id,
      ...address('Via Verdi'),
      streetNumber: '10',
    })
    const organisation = await Customer.create({
      type: 'organisation',
      name: 'A.S.D. Polisportiva Navigli',
      taxCode: '97654321013',
      paymentTermsId: rimessa.id,
      ...address('Alzaia Naviglio Grande', 'Milano', 'MI', '20144'),
      streetNumber: '120',
    })

    const home = await Site.create({
      label: 'Casa Rossi',
      ...address('Via Garibaldi'),
      streetNumber: '5',
      accessNotes: 'Citofono "Rossi", secondo piano.',
    })
    await privateCustomer.related('sites').attach([home.id])
    await InstalledEquipment.create({
      siteId: home.id,
      equipmentType: 'Caldaia murale',
      make: 'Vaillant',
      model: 'ecoTEC plus',
      serialNumber: 'VT-2014-88231',
      installedOn: DateTime.fromISO('2014-10-01'),
      lastServicedOn: DateTime.now().minus({ months: 13 }).startOf('day'),
      maintenanceIntervalMonths: 12,
    })

    const office = await Site.create({
      label: 'Uffici',
      ...address('Corso Buenos Aires'),
      streetNumber: '44',
      residential: false,
    })
    await company.related('sites').attach([office.id])

    const building = await Site.create({
      label: 'Centrale termica',
      ...address('Via Verdi'),
      streetNumber: '10',
      accessNotes: 'Chiavi dal portiere, 8–12.',
    })
    await condominium.related('sites').attach([building.id])
    await InstalledEquipment.create({
      siteId: building.id,
      equipmentType: 'Caldaia a basamento',
      make: 'Riello',
      serialNumber: 'RL-2019-0042',
      installedOn: DateTime.fromISO('2019-09-15'),
      maintenanceIntervalMonths: 12,
    })

    const club = await Site.create({
      label: 'Spogliatoi',
      ...address('Alzaia Naviglio Grande', 'Milano', 'MI', '20144'),
      streetNumber: '120',
      residential: false,
    })
    await organisation.related('sites').attach([club.id])

    // Each Customer with the Site their Jobs happen at
    return {
      private: { customer: privateCustomer, siteId: home.id },
      company: { customer: company, siteId: office.id },
      condominium: { customer: condominium, siteId: building.id },
      organisation: { customer: organisation, siteId: club.id },
    }
  }

  private async job(
    { customer, siteId }: { customer: Customer; siteId: number },
    kind: JobKind,
    workCategory: WorkCategory,
    title: string
  ) {
    return db.transaction(async (trx) => {
      const year = DateTime.now().year
      return Job.create(
        {
          year,
          sequence: await nextJobSequence(trx, year),
          customerId: customer.id,
          siteId,
          kind,
          workCategory,
          status: 'open',
          title,
        },
        { client: trx }
      )
    })
  }

  private report() {
    const lines = [
      'Development data ready. Password for every account: ' + DEV_PASSWORD,
      `  Superuser   ${DEV_LOGINS.superuser}`,
      `  Admin       ${DEV_LOGINS.admin}`,
      `  Office      ${DEV_LOGINS.office}`,
      ...DEV_LOGINS.technicians.map((email) => `  Technician  ${email}`),
    ]
    if (!app.inTest) console.log(lines.join('\n'))
  }
}
