import { setTimeout as sleep } from 'node:timers/promises'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import InstanceSettings from '#models/instance_settings'
import SdiPolling, { isPollDue } from '#services/sdi_polling'

/** How often the poller checks whether a poll is due */
const TICK_MS = 60_000

/**
 * The SDI poller (#92, ADR 0019): runs in the `sdi` Compose service and
 * polls the intermediary every "polling minutes" from Instance settings,
 * or sooner when a webhook asks. With no connection it only waits. If the
 * server was off, the first poll catches up on everything missed.
 */
export default class SdiPoll extends BaseCommand {
  static commandName = 'sdi:poll'
  static description =
    'Poll the SDI intermediary for outcomes and Supplier Invoices (stays running)'

  static options: CommandOptions = { startApp: true, staysAlive: true }

  @flags.boolean({ description: 'Poll once and exit' })
  declare once: boolean

  async run() {
    if (this.once) {
      await this.poll()
      return this.terminate()
    }
    while (true) {
      try {
        if (isPollDue(await InstanceSettings.current())) await this.poll()
      } catch (error) {
        // The database is unreachable: try again on the next tick
        this.logger.error(`SDI poll not started: ${error instanceof Error ? error.message : error}`)
      }
      await sleep(TICK_MS)
    }
  }

  async poll() {
    const report = await SdiPolling.poll()
    if (!report.polled) return
    this.logger.info(
      `SDI poll: ${report.settled} sends settled, ${report.outcomes} outcomes, ` +
        `${report.received} files received, ${report.handed} handed over`
    )
    for (const { step, subject, detail } of report.failures) {
      this.logger.warning(`${step} ${subject ?? ''}: ${detail}`)
    }
  }
}
