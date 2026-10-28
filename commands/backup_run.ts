import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { Backups } from '#services/backups'

/**
 * Takes one backup now (#33), as the nightly job does. The outcome is
 * recorded in Instance settings; the exit code is non-zero on failure.
 */
export default class BackupRun extends BaseCommand {
  static commandName = 'backup:run'
  static description = 'Take an encrypted off-site backup now'

  static options: CommandOptions = { startApp: true }

  async run() {
    const outcome = await Backups.run()
    if (outcome === 'succeeded') this.logger.success('Backup uploaded')
    else if (outcome === 'busy') this.logger.warning('A backup is already running')
    else {
      this.logger.error('Backup failed: see Instance settings')
      this.exitCode = 1
    }
  }
}
