export interface EmailDeliveryRecipient {
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  bouncedAt: Date | null;
}

export const EMAIL_DELIVERY_RESULTS = [
  ['Delivered', 'delivered'], ['Bounced', 'bounced or dropped'],
  ['Opened', 'opened'], ['Clicked', 'with a link clicked'],
] as const;

export function hasEmailDeliveryResult(recipient: EmailDeliveryRecipient): boolean {
  return !!(recipient.deliveredAt || recipient.openedAt || recipient.clickedAt || recipient.bouncedAt);
}

/** Count provider evidence even when a legacy message has no tracking flag. */
export function summarizeEmailDelivery(recipients: EmailDeliveryRecipient[], options: {
  hasSends: boolean;
  /** All recipients have confirmed engagement tracking, not just one message. */
  trackingEnabled: boolean;
  trackedRecipients?: EmailDeliveryRecipient[];
  lastWebhookEvent: Date | null | undefined;
  now: Date;
}) {
  const accepted = recipients.filter(recipient => recipient.sentAt);
  const settled = options.now.getTime() - 15 * 60_000;
  const tracked = (options.trackedRecipients ?? (options.trackingEnabled ? accepted : [])).filter(recipient => recipient.sentAt);
  const reportingMissing = tracked.some(recipient =>
    recipient.sentAt!.getTime() < settled && !hasEmailDeliveryResult(recipient)
    && (!options.lastWebhookEvent || options.lastWebhookEvent < recipient.sentAt!));
  const zeroKnown = !options.hasSends || (options.trackingEnabled && accepted.length > 0 && !reportingMissing);
  // Historical terminal events can prove zero deliveries/bounces. They do not
  // establish whether tracking pixels or link tracking were enabled at send time.
  const deliveryComplete = accepted.length > 0 && accepted.every(recipient => recipient.deliveredAt || recipient.bouncedAt);
  const counts = {
    Delivered: accepted.filter(recipient => recipient.deliveredAt).length,
    Bounced: accepted.filter(recipient => recipient.bouncedAt).length,
    Opened: accepted.filter(recipient => recipient.openedAt || recipient.clickedAt).length,
    Clicked: accepted.filter(recipient => recipient.clickedAt).length,
  };
  return {
    reportingMissing,
    counts: Object.fromEntries(EMAIL_DELIVERY_RESULTS.map(([key]) => [key,
      counts[key] > 0 || zeroKnown || (deliveryComplete && (key === 'Delivered' || key === 'Bounced'))
        ? counts[key] : null,
    ])) as Record<keyof typeof counts, number | null>,
  };
}
