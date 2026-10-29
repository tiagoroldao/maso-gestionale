/**
 * Why a send or a poll step failed, when the app itself knows (ADR 0019).
 * Pages show these through the catalogue (`ui.sdiFailures`); any other
 * failure is the intermediary's own message, shown as it is.
 */
export const SDI_FAILURE_CODES = [
  'notFoundAtIntermediary',
  'noRemoteId',
  'submissionRefused',
  'noticeBeforeSubmission',
  'noFiscalId',
  'tooManyPages',
  // Legal archiving of a Supplier Invoice (#214): SDI's identifier is
  // needed and the file has none, or a send was cut off before its answer
  'noSdiIdentifier',
  'archivingInterrupted',
] as const
export type SdiFailureCode = (typeof SDI_FAILURE_CODES)[number]

export function isSdiFailureCode(value: string | null | undefined): value is SdiFailureCode {
  return SDI_FAILURE_CODES.includes(value as SdiFailureCode)
}

/** The steps of a poll, each named in the catalogue (`ui.instance.pollSteps`) */
export const POLL_STEPS = [
  'register',
  'unsettled',
  'settle',
  'waiting',
  'outcome',
  'received',
  'download',
  'handOver',
  'archive',
] as const
export type PollStep = (typeof POLL_STEPS)[number]

/**
 * A step of a poll that failed: which, on what (a file name or the
 * intermediary's id), and why (a code above or the intermediary's message).
 */
export type PollFailure = { step: PollStep; subject: string | null; detail: string }
