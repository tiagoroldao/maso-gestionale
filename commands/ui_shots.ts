import { spawn } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import type { Browser } from 'playwright'
import env from '#start/env'
import { DEV_LOGINS, DEV_PASSWORD } from '#database/seeders/dev_seeder'
import { SCREEN_SIZES } from '#shared/screen_sizes'

const ROLES = {
  office: DEV_LOGINS.office,
  admin: DEV_LOGINS.admin,
  technician: DEV_LOGINS.technicians[0],
  superuser: DEV_LOGINS.superuser,
} as const
type Role = keyof typeof ROLES
/** `--role=none`: signed out, for the sign-in and setup screens */
const SIGNED_OUT = 'none'
const ROLE_CHOICES = [...Object.keys(ROLES), SIGNED_OUT].join(', ')

const THEMES = ['light', 'dark'] as const
const OUT_DIR = 'tmp/ui-shots'
const SERVER_START_SECONDS = 90

/**
 * Screenshots of app pages for checking a screen against docs/ui.md
 * (#252): each path at the three screen sizes (shared/screen_sizes.ts),
 * light and dark, logged in as one of the dev seeder's accounts (or signed
 * out, with `--role=none`). Prints the
 * PNGs' absolute paths (in tmp/ui-shots, git-ignored).
 *
 * Uses the server on this checkout's HOST and PORT, or starts `node ace
 * serve` for the run and stops it after. The database is whatever .env
 * points at, seeded with `node ace db:seed` (in a worktree, a scratch
 * database: docs/agent-workflow.md). It only reads pages, never submits
 * forms other than the login.
 */
export default class UiShots extends BaseCommand {
  static commandName = 'ui:shots'
  static description =
    'Screenshot app pages at phone, tablet and desktop widths, light and dark, as a seeded account'

  static options: CommandOptions = { startApp: true }

  @args.spread({ description: 'Paths to shoot, e.g. /jobs /jobs/1' })
  declare paths: string[]

  @flags.string({
    description: `The dev seeder account to log in as (none: signed out): ${ROLE_CHOICES}`,
    default: 'office',
  })
  declare role: string

  async run() {
    if (this.app.inProduction) {
      this.logger.error('ui:shots logs in with the development accounts: never in production')
      this.exitCode = 1
      return
    }
    if (!(this.role in ROLES) && this.role !== SIGNED_OUT) {
      this.logger.error(`Unknown role "${this.role}": use ${ROLE_CHOICES}`)
      this.exitCode = 1
      return
    }
    if (this.paths.length === 0) {
      this.logger.error('Give at least one path, e.g. npm run ui:shots -- /jobs')
      this.exitCode = 1
      return
    }
    const paths = this.paths.map((path) => (path.startsWith('/') ? path : `/${path}`))

    const host = env.get('HOST')
    const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${env.get('PORT')}`
    const outDir = this.app.makePath(OUT_DIR)
    await mkdir(outDir, { recursive: true })

    let stopServer: (() => void) | undefined
    let browser: Browser | undefined
    try {
      if (await this.isUp(base)) {
        this.logger.warning(
          `A server already answers at ${base}: using it. If it isn't this checkout's (another worktree on the same PORT), stop it or set another PORT.`
        )
      } else {
        stopServer = await this.startServer(base, join(outDir, 'server.log'))
      }

      // Imported here: playwright is a dev dependency, absent from the production image
      const { chromium } = await import('playwright')
      browser = await chromium.launch()
      const storageState =
        this.role === SIGNED_OUT
          ? undefined
          : await this.logIn(browser, base, ROLES[this.role as Role])

      for (const path of paths) {
        for (const theme of THEMES) {
          const context = await browser.newContext({ storageState, colorScheme: theme })
          const page = await context.newPage()
          for (const [size, viewport] of Object.entries(SCREEN_SIZES)) {
            await page.setViewportSize(viewport)
            const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
            // Self-hosted fonts loaded (a string: the server's types have no DOM)
            await page.evaluate('document.fonts.ready.then(() => true)')
            const file = join(
              outDir,
              `${slug(path)}--${this.role}--${size}-${viewport.width}--${theme}.png`
            )
            await page.screenshot({ path: file, fullPage: true, animations: 'disabled' })
            const status = response?.status() ?? 0
            this.logger.log(status >= 400 ? `${file}  (HTTP ${status})` : file)
          }
          await context.close()
        }
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error))
      this.exitCode = 1
    } finally {
      await browser?.close()
      stopServer?.()
    }
  }

  private async isUp(base: string) {
    try {
      await fetch(`${base}/login`, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
      return true
    } catch {
      return false
    }
  }

  /**
   * `node ace serve` in its own process group, so stopping it stops its
   * child too. Returns the function that stops it; until then, Ctrl-C or
   * the command exiting stops it as well, so no server is left behind
   * holding the database.
   */
  private async startServer(base: string, logPath: string) {
    this.logger.info(`Starting the server at ${base} (log: ${logPath})`)
    const log = await open(logPath, 'w')
    const server = spawn(process.execPath, ['ace', 'serve'], {
      cwd: this.app.appRoot,
      env: process.env,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    })
    // The server has its own copy of the descriptor
    await log.close()

    const kill = () => {
      if (!server.pid || server.exitCode !== null) return
      try {
        process.kill(-server.pid, 'SIGTERM')
      } catch {
        // Already gone
      }
    }
    const onSignal = (signal: NodeJS.Signals) => {
      kill()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    process.once('exit', kill)
    const stop = () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      process.off('exit', kill)
      kill()
    }

    for (let waited = 0; waited < SERVER_START_SECONDS; waited++) {
      if (server.exitCode !== null) break
      if (await this.isUp(base)) return stop
      await sleep(1000)
    }
    stop()
    throw new Error(`The server did not start at ${base}: see ${logPath}`)
  }

  private async logIn(browser: Browser, base: string, email: string) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
    await page.locator('input[name="email"]').fill(email)
    await page.locator('input[name="password"]').fill(DEV_PASSWORD)
    await page.locator('button[type="submit"]').click()
    try {
      await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15_000 })
    } catch {
      throw new Error(
        `Could not log in as ${email}: is the database seeded? (node ace db:seed, on a scratch database in a worktree)`
      )
    }
    const state = await context.storageState()
    await context.close()
    return state
  }
}

/** "/jobs/1/edit" → "jobs-1-edit", "/jobs?page=2" → "jobs-page-2", "/" → "home" */
function slug(path: string) {
  return (
    path
      .replace(/[?#].*$/, '')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '') || 'home'
  )
}
