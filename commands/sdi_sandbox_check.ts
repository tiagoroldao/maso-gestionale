import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { PLACEHOLDER_CALLBACK_URL } from '#services/sdi_receiving'
import { SANDBOX_FISCAL_ID, SandboxOnlyError, SdiSandboxCheck } from '#services/sdi_sandbox_check'

/**
 * Checks Openapi's sandbox against what the app assumes (#219, #204, ADR
 * 0019) and prints a Markdown report to paste on #204; the exit code is
 * non-zero when a check fails. Sandbox only, with OPENAPI_SANDBOX_TOKEN
 * from the environment. It sends test documents and simulates; it changes
 * the account's set-up only with `--setup` or `--cleanup`.
 * See docs/openapi-sandbox-check.md.
 */
export default class SdiSandboxCheckCommand extends BaseCommand {
  static commandName = 'sdi:sandbox-check'
  static description =
    "Check Openapi's sandbox against the app's assumptions and print a Markdown report"

  static options: CommandOptions = { startApp: true }

  @flags.boolean({
    description:
      'First create the Business Registry Configuration and the supplier-invoice callback',
  })
  declare setup: boolean

  @flags.boolean({ description: 'Only remove the callback configuration, without checks' })
  declare cleanup: boolean

  @flags.string({
    description: 'The fiscal id the sandbox account uses',
    default: SANDBOX_FISCAL_ID,
  })
  declare fiscalId: string

  @flags.string({
    description: 'Where --setup points the supplier-invoice callback',
    default: PLACEHOLDER_CALLBACK_URL,
  })
  declare callbackUrl: string

  @flags.number({
    description: 'Seconds to wait for Openapi to list or store something',
    default: 120,
  })
  declare wait: number

  @flags.string({ flagName: 'p7m', description: 'A signed .p7m file to try importing in check 8' })
  declare p7m?: string

  async run() {
    const token = process.env.OPENAPI_SANDBOX_TOKEN
    if (!token) {
      this.logger.error('OPENAPI_SANDBOX_TOKEN is not set')
      this.exitCode = 1
      return
    }
    if (this.setup && this.cleanup) {
      this.logger.error('Use --setup or --cleanup, not both')
      this.exitCode = 1
      return
    }

    let check: SdiSandboxCheck
    try {
      check = new SdiSandboxCheck({
        token,
        fiscalId: this.fiscalId,
        callbackUrl: this.callbackUrl,
        setup: this.setup,
        waitSeconds: this.wait,
        p7mPath: this.p7m ?? null,
        // On stderr, so stdout is only the report
        progress: (line) => this.logger.logError(`… ${line}`),
      })
    } catch (error) {
      if (!(error instanceof SandboxOnlyError)) throw error
      this.logger.error(error.message)
      this.exitCode = 1
      return
    }

    const report = this.cleanup ? await check.cleanup() : await check.run()
    this.logger.log(report)
    if (check.failed) this.exitCode = 1
  }
}
