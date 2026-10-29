import InstanceSettings from '#models/instance_settings'
import { OpenapiSdiGateway } from '#services/openapi_sdi_gateway'
import { ManualSdiGateway, type SdiGateway } from '#services/sdi_gateway'

export const manualGateway = new ManualSdiGateway()

/**
 * The gateway the Instance settings ask for (ADR 0019). With no
 * connection (manual mode, or no usable token) the app works by hand:
 * Office uploads files on the SDI portal and records outcomes.
 */
export function gatewayFor(settings: InstanceSettings): SdiGateway {
  if (settings.sdiMode !== 'openapi') return manualGateway
  // A token that no longer decrypts reads as none; Instance settings and
  // the poller say so
  const token = settings.token
  if (!token) return manualGateway
  return new OpenapiSdiGateway({ token, environment: settings.sdiEnvironment })
}

/**
 * Which gateway sends Submissions and polls, read from the settings each
 * time so a change applies at once. Tests put a fake in its place.
 */
export default class SdiConnection {
  private static replacement: SdiGateway | null = null

  static async gateway(): Promise<SdiGateway> {
    return this.replacement ?? gatewayFor(await InstanceSettings.current())
  }

  /** For tests: this gateway instead of the settings' one, until `restore` */
  static use(gateway: SdiGateway) {
    this.replacement = gateway
  }

  static restore() {
    this.replacement = null
  }
}
