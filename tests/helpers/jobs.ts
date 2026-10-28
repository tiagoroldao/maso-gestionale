import { DateTime } from 'luxon'
import Job from '#models/job'
import type Customer from '#models/customer'

let sequence = 1000

export function createJob(customer: Customer, attributes: Partial<Job> = {}) {
  sequence++
  return Job.create({
    year: DateTime.now().year,
    sequence,
    customerId: customer.id,
    status: 'open',
    title: `Lavoro ${sequence}`,
    ...attributes,
  })
}
