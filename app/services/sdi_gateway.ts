/**
 * A FatturaPA file ready to go to SDI.
 */
export type SdiFile = { fileName: string; xml: string }

/**
 * How Submissions reach SDI (ADR 0004). The manual gateway relies on
 * Office uploading the file on the SDI portal; an intermediary
 * (Invoicetronic) will implement the same interface and report outcomes.
 */
export interface SdiGateway {
  readonly channel: string
  /** Called when a Submission is confirmed: hands the file to SDI */
  submit(file: SdiFile): Promise<void>
}

/**
 * Office uploads the file themselves and confirms it in the app, so there
 * is nothing to send.
 */
export class ManualSdiGateway implements SdiGateway {
  readonly channel = 'manual'
  async submit() {}
}

/**
 * Keeps what it is given, for tests.
 */
export class FakeSdiGateway implements SdiGateway {
  readonly channel = 'fake'
  readonly submitted: SdiFile[] = []
  async submit(file: SdiFile) {
    this.submitted.push(file)
  }
}
