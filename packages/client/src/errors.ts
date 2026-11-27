/** Shared structured error type for SHE clients. */

import type { SheErrorCode } from '@she/protocol'

export const SHE_CLIENT_VERSION = '0.1.1'

export type SheClientErrorCode = SheErrorCode | 'transport_error'

export class SheClientError extends Error {
  readonly code: SheClientErrorCode
  readonly retryable: boolean
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    code: SheClientErrorCode,
    message: string,
    options: { readonly retryable?: boolean; readonly details?: Readonly<Record<string, unknown>> } = {},
  ) {
    super(message)
    this.name = 'SheClientError'
    this.code = code
    this.retryable = options.retryable ?? false
    if (options.details !== undefined) this.details = options.details
  }
}
