export class SenderDomainNotConfiguredError extends Error {
  readonly code = 'SENDER_DOMAIN_NOT_CONFIGURED' as const;

  constructor(domain?: string) {
    super(
      domain
        ? `This domain (${domain}) is not configured for sending. Authenticate it in SendGrid or use an allowed address.`
        : 'This email domain is not configured for sending.',
    );
    this.name = 'SenderDomainNotConfiguredError';
  }
}

export class SenderDomainVerificationUnavailableError extends Error {
  readonly code = 'SENDER_DOMAIN_VERIFY_UNAVAILABLE' as const;

  constructor(message = 'Could not verify email domain with SendGrid. Try again shortly.') {
    super(message);
    this.name = 'SenderDomainVerificationUnavailableError';
  }
}

export function isSenderDomainError(err: unknown): err is SenderDomainNotConfiguredError | SenderDomainVerificationUnavailableError {
  return (
    err instanceof SenderDomainNotConfiguredError ||
    err instanceof SenderDomainVerificationUnavailableError
  );
}
