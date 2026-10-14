/** Input observations awaiting a confirmed server heartbeat. */
export class ActivityInputBuffer {
  private pending: number[] = [];
  private latest: number | null = null;
  private confirmedThrough: number | null = null;

  record(at: number): void {
    if (!Number.isFinite(at) || at < 0) return;
    this.latest = this.latest === null ? at : Math.max(this.latest, at);
    if (this.confirmedThrough !== null && at <= this.confirmedThrough) return;
    // Relays from other tabs can arrive out of order. Keep both interval edges exact.
    let low = 0;
    let high = this.pending.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.pending[middle] < at) low = middle + 1;
      else high = middle;
    }
    if (this.pending[low] !== at) this.pending.splice(low, 0, at);
  }

  snapshot() {
    return {
      firstActivityAt: this.pending.length ? new Date(this.pending[0]).toISOString() : null,
      lastActivityAt: this.latest === null ? null : new Date(this.latest).toISOString(),
      acknowledgedThrough: this.pending[this.pending.length - 1] ?? null,
    };
  }

  acknowledge(through: number | null): void {
    if (through !== null && Number.isFinite(through)) {
      this.confirmedThrough = Math.max(this.confirmedThrough ?? through, through);
      this.pending = this.pending.filter((at) => at > this.confirmedThrough!);
    }
  }

  share(): { pending: number[]; latest: number | null; confirmedThrough: number | null } {
    return { pending: [...this.pending], latest: this.latest, confirmedThrough: this.confirmedThrough };
  }

  merge(data: ReturnType<ActivityInputBuffer['share']>): void {
    this.acknowledge(data.confirmedThrough);
    data.pending.forEach((at) => this.record(at));
    if (data.latest !== null && Number.isFinite(data.latest)) {
      this.latest = this.latest === null ? data.latest : Math.max(this.latest, data.latest);
    }
  }
}

export interface ScopedActivitySnapshot {
  generation: number;
  snapshot: ReturnType<ActivityInputBuffer['snapshot']>;
}

/** Only an explicit server opt-in allows observations; changing scope drops all prior input. */
export class ActivityTrackingScope {
  private inputBuffer = new ActivityInputBuffer();
  private generation = 0;
  private enabledSince = Infinity;
  enabled = false;

  setEnabled(value: unknown, now: number): boolean {
    const enabled = value === true;
    if (enabled === this.enabled) return false;
    this.enabled = enabled;
    this.reset(now);
    return true;
  }

  reset(now: number): void {
    this.generation += 1;
    this.enabledSince = this.enabled ? now : Infinity;
    this.inputBuffer = new ActivityInputBuffer();
  }

  record(at: number): boolean {
    if (!this.enabled || !Number.isFinite(at) || at < this.enabledSince) return false;
    this.inputBuffer.record(at);
    return true;
  }

  capture(): ScopedActivitySnapshot | null {
    return this.enabled ? { generation: this.generation, snapshot: this.inputBuffer.snapshot() } : null;
  }

  acknowledge(captured: ScopedActivitySnapshot): boolean {
    if (!this.enabled || captured.generation !== this.generation) return false;
    this.inputBuffer.acknowledge(captured.snapshot.acknowledgedThrough);
    return true;
  }

  acknowledgeRelay(through: number | null): void {
    if (this.enabled && through !== null && through >= this.enabledSince) this.inputBuffer.acknowledge(through);
  }

  share(): ReturnType<ActivityInputBuffer['share']> | null {
    return this.enabled ? this.inputBuffer.share() : null;
  }

  merge(data: ReturnType<ActivityInputBuffer['share']>): void {
    if (!this.enabled) return;
    // A tab may still be delivering messages from before this tab learned of a scope change.
    this.inputBuffer.merge({
      pending: data.pending.filter((at) => at >= this.enabledSince),
      latest: data.latest !== null && data.latest >= this.enabledSince ? data.latest : null,
      confirmedThrough: data.confirmedThrough !== null && data.confirmedThrough >= this.enabledSince
        ? data.confirmedThrough : null,
    });
  }
}

export interface ActivityLease {
  owner: string;
  expiresAt: number;
  visibility?: 'visible' | 'hidden';
}

/** Visible tabs take priority over hidden owners; otherwise ownership lasts until expiry. */
export function canClaimActivityLease(
  lease: ActivityLease | null,
  owner: string,
  now: number,
  visibility: 'visible' | 'hidden' = 'visible',
): boolean {
  return !lease || !Number.isFinite(lease.expiresAt) || lease.expiresAt <= now || lease.owner === owner
    || (visibility === 'visible' && lease.visibility === 'hidden');
}

/** A resumed old leader must recheck shared ownership before sending observations. */
export function ownsActivityLease(lease: ActivityLease | null, owner: string, now: number): boolean {
  return lease?.owner === owner && Number.isFinite(lease.expiresAt) && lease.expiresAt > now;
}
