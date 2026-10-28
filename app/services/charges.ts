import Big from 'big.js'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Charge from '#models/charge'
import ChargeEvent, { type ChargeChanges } from '#models/charge_event'
import InstalledEquipment from '#models/installed_equipment'
import Item from '#models/item'
import Job from '#models/job'
import LabourRate from '#models/labour_rate'
import User from '#models/user'
import Visit from '#models/visit'
import StockLedger from '#stock/stock_ledger'
import { chargeState } from '#shared/charges'
import type { LineKind } from '#shared/vat'
import { labourDescription } from '#services/field_work'

/**
 * An Invoice holds the Charge (a draft or an issued one), so what is
 * billed changes only through billing (ADR 0010); its Job was cancelled,
 * which freezes billing; or a correction picked an archived Labour Rate
 * or Item, or a Technician who is inactive or not on the Visit; or it
 * would change the Item of equipment the Charge doesn't own alone.
 */
export class ChargeRefusedError extends Error {
  constructor(readonly reason: 'billed' | 'cancelled' | 'archived' | 'worker' | 'installed') {
    super(reason)
  }
}

type Recorded = {
  quantity: string
  // Labour: the Labour Rate, and an app user or someone outside the app
  labourRateId?: number
  technicianId?: number | null
  workerName?: string | null
  // Item
  itemId?: number
}

type Billing = {
  quantity: string
  unitPrice: string
  description: string
  // Another cost's own unit and VAT kind (ignored for hours and Items)
  unit?: string | null
  vatKind?: LineKind
}

/**
 * Office's side of Charges (ADR 0010): adding other costs to a Job,
 * correcting what was recorded, editing what is billed, and marking a
 * Charge not billable. Each is an event in the Charge's history. Every
 * change locks the Charge's Visit, then its Job (the order field work and
 * invoicing use), then the Charge.
 */
export default class Charges {
  /**
   * Adds another cost to the Job itself (a call-out, a contractor's day,
   * materials bought for the Job), priced by Office. Not on a cancelled
   * Job.
   */
  static async add(job: Job, input: Required<Billing>, user: User) {
    return db.transaction(async (trx) => {
      const locked = await Job.query({ client: trx }).where('id', job.id).forShare().firstOrFail()
      if (locked.status === 'cancelled') throw new ChargeRefusedError('cancelled')
      const charge = await Charge.create(
        {
          jobId: locked.id,
          kind: 'other',
          quantity: input.quantity,
          billQuantity: input.quantity,
          unitPrice: input.unitPrice,
          description: input.description,
          unit: input.unit,
          vatKind: input.vatKind,
        },
        { client: trx }
      )
      await ChargeEvent.create(
        { chargeId: charge.id, kind: 'recorded', userId: user.id },
        { client: trx }
      )
      return charge
    })
  }

  /**
   * Corrects what was recorded, at any time. An Item already taken off
   * stock moves stock by the difference, with new Stock Movements. While
   * nothing billed it, its Job isn't cancelled and Office never edited its
   * billing, what is billed follows: the quantity, the description and,
   * for a new Labour Rate or Item, its current price.
   */
  static async correct(
    charge: Charge,
    input: Recorded,
    user: User,
    stockReason: string
  ): Promise<void> {
    await this.whileLocked(charge, async (trx, locked, job) => {
      const before = await this.recordedValues(trx, locked)
      const billingFollows =
        job.status !== 'cancelled' &&
        locked.invoiceId === null &&
        !(await this.hasEvent(trx, locked.id, 'billing_edited'))

      if (locked.kind === 'labour') {
        const rate = await LabourRate.findOrFail(input.labourRateId, { client: trx })
        if (rate.archivedAt && rate.id !== locked.labourRateId) {
          throw new ChargeRefusedError('archived')
        }
        const technician = input.technicianId
          ? await User.findOrFail(input.technicianId, { client: trx })
          : null
        // Hours belong to someone on the Visit (Scheduling relies on it);
        // the Charge's own worker can stay whatever happened since
        if (technician && technician.id !== locked.userId) {
          const onVisit =
            !locked.visitId ||
            (await trx
              .from('visit_technicians')
              .where('visit_id', locked.visitId)
              .where('user_id', technician.id)
              .first())
          const working = technician.role === 'technician' && technician.isActive
          if (!working || !onVisit) throw new ChargeRefusedError('worker')
        }
        const worker = technician
          ? (technician.fullName ?? technician.email)
          : input.workerName!.trim()
        if (billingFollows) {
          if (rate.id !== locked.labourRateId) locked.unitPrice = rate.hourlyPrice
          locked.description = labourDescription(rate.name, worker)
        }
        locked.merge({
          labourRateId: rate.id,
          userId: technician?.id ?? null,
          workerName: technician ? null : worker,
        })
      } else if (locked.kind === 'item') {
        const item = await Item.findOrFail(input.itemId, { client: trx })
        if (item.archivedAt && item.id !== locked.itemId) throw new ChargeRefusedError('archived')
        if (item.id !== locked.itemId && locked.installedEquipmentId) {
          await this.moveEquipment(trx, locked, item)
        }
        if (locked.stockMovementId) {
          await this.moveStock(trx, locked, item, input.quantity, { job, user, stockReason })
        }
        if (billingFollows) {
          if (item.id !== locked.itemId) locked.unitPrice = item.resalePrice
          locked.description = item.description.slice(0, 255)
        }
        locked.itemId = item.id
      }
      locked.quantity = input.quantity
      if (billingFollows) locked.billQuantity = input.quantity
      await locked.save()

      const changes = diff(before, await this.recordedValues(trx, locked))
      if (changes) await this.addEvent(trx, locked, 'corrected', user, changes)
    })
  }

  /**
   * Edits what is billed, until an Invoice holds the Charge.
   */
  static async editBilling(charge: Charge, input: Billing, user: User): Promise<void> {
    await this.whileLocked(charge, async (trx, locked, job) => {
      this.refuseBillingChange(locked, job)
      const before = billingValues(locked)
      locked.merge({
        billQuantity: input.quantity,
        unitPrice: input.unitPrice,
        description: input.description,
      })
      if (locked.kind === 'other') {
        locked.merge({ unit: input.unit ?? null, vatKind: input.vatKind ?? locked.vatKind })
      }
      await locked.save()
      const changes = diff(before, billingValues(locked))
      if (changes) await this.addEvent(trx, locked, 'billing_edited', user, changes)
    })
  }

  /**
   * Marks the Charge not billable, or billable again, until an Invoice
   * holds it. Marking it as it already is changes nothing.
   */
  static async setBillable(charge: Charge, billable: boolean, user: User): Promise<void> {
    await this.whileLocked(charge, async (trx, locked, job) => {
      this.refuseBillingChange(locked, job)
      const events = await ChargeEvent.query({ client: trx })
        .where('chargeId', locked.id)
        .orderBy('id')
      const notBillable = chargeState(events, null) === 'not_billable'
      if (notBillable !== billable) return
      await this.addEvent(trx, locked, billable ? 'billable' : 'not_billable', user, null)
    })
  }

  /**
   * What is billed is frozen once an Invoice holds the Charge, and on a
   * cancelled Job (what was recorded can still be corrected).
   */
  private static refuseBillingChange(charge: Charge, job: Job) {
    if (job.status === 'cancelled') throw new ChargeRefusedError('cancelled')
    if (charge.invoiceId !== null) throw new ChargeRefusedError('billed')
  }

  /**
   * An installed Item replaced by another: the equipment this Charge
   * created now is the new Item, with its description and maintenance
   * interval unless those were set by hand. Equipment this Charge only
   * linked to, or that another Charge has installed onto or a Visit
   * serviced since, isn't this Charge's alone to change.
   */
  private static async moveEquipment(trx: TransactionClientContract, charge: Charge, item: Item) {
    if (!charge.createdEquipment) throw new ChargeRefusedError('installed')
    // Locked after the Visit and Job, as removing the Charge does
    const equipment = await InstalledEquipment.query({ client: trx })
      .where('id', charge.installedEquipmentId!)
      .forUpdate()
      .first()
    if (!equipment) return
    const sharedSince =
      equipment.itemId !== charge.itemId ||
      (await trx
        .from('charges')
        .where('installed_equipment_id', equipment.id)
        .whereNot('id', charge.id)
        .first()) ||
      (await trx
        .from('visit_serviced_equipment')
        .where('installed_equipment_id', equipment.id)
        .first())
    if (sharedSince) throw new ChargeRefusedError('installed')

    const previous = await Item.findOrFail(charge.itemId, { client: trx })
    const type = (description: string) => description.slice(0, 100)
    equipment.merge({
      itemId: item.id,
      equipmentType:
        equipment.equipmentType === type(previous.description)
          ? type(item.description)
          : equipment.equipmentType,
      maintenanceIntervalMonths:
        equipment.maintenanceIntervalMonths === previous.maintenanceIntervalMonths
          ? item.maintenanceIntervalMonths
          : equipment.maintenanceIntervalMonths,
    })
    await equipment.useTransaction(trx).save()
  }

  /**
   * Books the difference in stock for a corrected Item Charge already off
   * stock: the same Item by the change in quantity, another Item by
   * returning the old one and using the new.
   */
  private static async moveStock(
    trx: TransactionClientContract,
    charge: Charge,
    item: Item,
    quantity: string,
    { job, user, stockReason }: { job: Job; user: User; stockReason: string }
  ) {
    const common = {
      occurredOn: DateTime.now().startOf('day'),
      reference: job.number,
      reason: stockReason,
      user,
      client: trx,
    }
    const moves: [number, Big][] =
      item.id === charge.itemId
        ? [[item.id, new Big(charge.quantity).minus(quantity)]]
        : [
            [charge.itemId!, new Big(charge.quantity)],
            [item.id, new Big(quantity).neg()],
          ]
    for (const [itemId, change] of moves) {
      if (change.eq(0)) continue
      const stocked = itemId === item.id ? item : await Item.findOrFail(itemId, { client: trx })
      await StockLedger.adjust(stocked, { ...common, quantity: change.toFixed(3) })
    }
  }

  /**
   * Runs `work` with the Charge's Visit locked, its Job share-locked and
   * the Charge re-read under lock.
   */
  private static whileLocked<T>(
    charge: Charge,
    work: (trx: TransactionClientContract, locked: Charge, job: Job) => Promise<T>
  ) {
    return db.transaction(async (trx) => {
      if (charge.visitId) {
        await Visit.query({ client: trx }).where('id', charge.visitId).forUpdate().firstOrFail()
      }
      const job = await Job.query({ client: trx })
        .where('id', charge.jobId)
        .forShare()
        .firstOrFail()
      const locked = await Charge.query({ client: trx })
        .where('id', charge.id)
        .forUpdate()
        .firstOrFail()
      return work(trx, locked, job)
    })
  }

  private static async hasEvent(trx: TransactionClientContract, chargeId: number, kind: string) {
    return Boolean(
      await ChargeEvent.query({ client: trx })
        .where('chargeId', chargeId)
        .where('kind', kind)
        .first()
    )
  }

  private static addEvent(
    trx: TransactionClientContract,
    charge: Charge,
    kind: ChargeEvent['kind'],
    user: User,
    changes: ChargeChanges | null
  ) {
    return ChargeEvent.create(
      { chargeId: charge.id, kind, userId: user.id, changes },
      { client: trx }
    )
  }

  /**
   * What was recorded, as shown to Office.
   */
  private static async recordedValues(
    trx: TransactionClientContract,
    charge: Charge
  ): Promise<Record<string, string | null>> {
    if (charge.kind === 'labour') {
      const rate = await LabourRate.findOrFail(charge.labourRateId, { client: trx })
      const technician = charge.userId ? await User.find(charge.userId, { client: trx }) : null
      return {
        quantity: charge.quantity,
        labourRate: rate.name,
        worker: technician ? (technician.fullName ?? technician.email) : charge.workerName,
      }
    }
    if (charge.kind === 'other') return { quantity: charge.quantity }
    const item = await Item.findOrFail(charge.itemId, { client: trx })
    return { quantity: charge.quantity, item: `${item.code} ${item.description}` }
  }
}

function billingValues(charge: Charge) {
  return {
    quantity: charge.billQuantity,
    unitPrice: charge.unitPrice,
    description: charge.description,
    unit: charge.unit,
    vatKind: charge.vatKind,
  }
}

/**
 * The values that changed, or null when none did. Decimals compare by
 * value ("2.000" and "2" are the same quantity).
 */
function diff(
  before: Record<string, string | null>,
  after: Record<string, string | null>
): ChargeChanges | null {
  const same = (a: string | null, b: string | null) => {
    if (a === b) return true
    if (a === null || b === null) return false
    try {
      return new Big(a).eq(b)
    } catch {
      return false
    }
  }
  const keys = Object.keys(after).filter((key) => !same(before[key], after[key]))
  if (!keys.length) return null
  return {
    before: Object.fromEntries(keys.map((key) => [key, before[key]])),
    after: Object.fromEntries(keys.map((key) => [key, after[key]])),
  }
}
