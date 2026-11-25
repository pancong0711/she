/** Broker-specific structured errors. */

export type BrokerErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'message_exists'
  | 'path_escape'
  | 'too_large'
  | 'docker_failed'
  | 'unavailable'

export class BrokerError extends Error {
  readonly code: BrokerErrorCode

  constructor(code: BrokerErrorCode, message: string) {
    super(message)
    this.name = 'BrokerError'
    this.code = code
  }
}

export function brokerErrorStatus(error: BrokerError): number {
  switch (error.code) {
    case 'not_found': return 404
    case 'forbidden': return 403
    case 'conflict':
    case 'message_exists': return 409
    case 'too_large': return 413
    case 'unavailable': return 503
    case 'docker_failed': return 502
    default: return 400
  }
}
