import { setTimeout as sleep } from 'node:timers/promises'
import { DateTime } from 'luxon'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import env from '#start/env'
import InstanceSettings from '#models/instance_settings'
import { Backups, nextBackupAt } from '#services/backups'

/**
 * The nightly backup job (#33): runs in the `backup` Compose service and
 * takes a backup every night at BACKUP_TIME (Europe/Rome, default 01:30,
 * clear of the daylight-saving changes). If the server was off at that
 * time (ADR 0002 accepts outages), it catches up when it starts.
 */
export default class BackupSchedule extends BaseCommand {
  static commandName = 'backup:schedule'
  static description = 'Run the nightly backup job (stays running)'

  static options: CommandOptions = { startApp: true, staysAlive: true }

  async run() {
    const time = env.get('BACKUP_TIME') ?? '01:30'
    if (await this.missedLastNight()) await this.backup()
    while (true) {
      const at = nextBackupAt(DateTime.now(), time)
      this.logger.info(`Next backup at ${at.toFormat('dd/MM/yyyy HH:mm')}`)
      await sleep(at.diffNow().as('milliseconds'))
      await this.backup()
    }
  }

  /**
   * No run, successful or not, in the last day.
   */
  async missedLastNight() {
    const settings = await InstanceSettings.current()
    const dayAgo = DateTime.now().minus({ hours: 24 })
    return [settings.backupSucceededAt, settings.backupFailedAt].every((at) => !at || at < dayAgo)
  }

  async backup() {
    try {
      this.logger.info(`Backup: ${await Backups.run()}`)
    } catch (error) {
      // The database is unreachable: try again the next night
      this.logger.error(`Backup not started: ${error instanceof Error ? error.message : error}`)
    }
  }
}
