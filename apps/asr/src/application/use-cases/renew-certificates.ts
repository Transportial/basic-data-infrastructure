// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import type { CertificateRepository } from '@bdi/crypto-ca';
import type { EventBusPort, ClockPort } from '../ports.ts';

// Emits `asr.certificate.renewal-due` for every issued-and-not-yet-revoked
// certificate whose notAfter falls within `thresholdSeconds` of "now". CONs
// (or their orchestrators) react by kicking off an ACME order to renew.
export class RenewCertificatesUseCase {
  constructor(
    private readonly certs: CertificateRepository,
    private readonly bus: EventBusPort,
    private readonly clock: ClockPort,
    private readonly associationId: string,
    private readonly thresholdSeconds: number = 30 * 86_400,
  ) {}

  async execute(): Promise<{ notified: number; skipped: number }> {
    let notified = 0;
    let skipped = 0;
    const thresholdMs = this.clock.nowMillis() + this.thresholdSeconds * 1000;
    const all = await this.certs.listAll();
    for (const cert of all) {
      if (cert.revokedAt) {
        skipped++;
        continue;
      }
      const expiresMs = new Date(cert.notAfter).getTime();
      if (expiresMs > thresholdMs) {
        skipped++;
        continue;
      }
      await this.bus.publish('asr.certificate.renewal-due', this.associationId, {
        serial: cert.serial,
        account_id: cert.accountId,
        order_id: cert.orderId,
        not_after: cert.notAfter,
      });
      notified++;
    }
    return { notified, skipped };
  }
}
