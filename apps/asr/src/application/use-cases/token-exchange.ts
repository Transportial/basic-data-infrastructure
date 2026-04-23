// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

import { err, ok, type Jwk, type Result } from '@bdi/kernel';
import { compactVerify, InMemoryTrustlist } from '@bdi/crypto';
import type { RawSigner } from '@bdi/crypto';
import {
  BVAD_CLAIM_ASSOCIATION,
  BVAD_CLAIM_ASSURANCE,
  BVAD_CLAIM_CONNECTOR,
  BVAD_CLAIM_ORGANISATION,
  BVAD_CLAIM_STATUS,
  BVAD_LIFETIME_SECONDS,
  validateBvadClaims,
  type BvadClaims,
} from '@bdi/contracts';
import type { ClockPort, EventBusPort, IdPort, SignerPort } from '../ports.ts';

export interface FederatedAssociation {
  readonly peer_issuer: string;
  readonly peer_kid: string;
  readonly peer_signer: RawSigner;
  readonly association_id: string;
  readonly peer_association_id: string;
  readonly allow: boolean;
}

export interface FederationRegistry {
  byIssuer(iss: string): Promise<FederatedAssociation | null>;
}

export class InMemoryFederationRegistry implements FederationRegistry {
  private readonly byIss = new Map<string, FederatedAssociation>();

  add(record: FederatedAssociation): void {
    this.byIss.set(record.peer_issuer, record);
  }

  async byIssuer(iss: string): Promise<FederatedAssociation | null> {
    return this.byIss.get(iss) ?? null;
  }
}

export type TokenExchangeError =
  | { type: 'missing-subject-token' }
  | { type: 'subject-token-unverifiable' }
  | { type: 'subject-token-expired' }
  | { type: 'peer-not-federated'; iss: string }
  | { type: 'peer-disabled' }
  | { type: 'wrong-peer-association'; expected: string; actual: string };

export interface TokenExchangeInput {
  readonly subjectToken: string;
  readonly audience: string;
  readonly scope?: string;
}

export interface TokenExchangeConfig {
  readonly issuer: string;
  readonly lifetimeSeconds?: number;
}

// RFC 8693 Token Exchange: accept a BVAD from a peer association, verify
// signature + freshness, and re-issue a locally-signed BVAD with
// federation provenance claims. The local connector-binding fields are
// zeroed out because the token does not represent one of our connectors.
export class TokenExchangeUseCase {
  constructor(
    private readonly federations: FederationRegistry,
    private readonly signer: SignerPort,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
    private readonly bus: EventBusPort,
    private readonly config: TokenExchangeConfig,
  ) {}

  async execute(input: TokenExchangeInput): Promise<Result<string, TokenExchangeError>> {
    if (!input.subjectToken) return err({ type: 'missing-subject-token' });

    const peekIssuer = this.extractIssuer(input.subjectToken);
    if (!peekIssuer) return err({ type: 'subject-token-unverifiable' });

    const peer = await this.federations.byIssuer(peekIssuer);
    if (!peer) return err({ type: 'peer-not-federated', iss: peekIssuer });
    if (!peer.allow) return err({ type: 'peer-disabled' });

    const trustlist = new InMemoryTrustlist();
    trustlist.add({ kid: peer.peer_kid, signer: peer.peer_signer });
    const verified = await compactVerify(input.subjectToken, trustlist);
    if (!verified.ok) return err({ type: 'subject-token-unverifiable' });

    const parsed = validateBvadClaims(verified.value.payload);
    if (!parsed.ok) return err({ type: 'subject-token-unverifiable' });
    const claims = parsed.value;

    const now = this.clock.nowUnix();
    if (now > claims.exp) return err({ type: 'subject-token-expired' });

    if (claims[BVAD_CLAIM_ASSOCIATION] !== peer.peer_association_id) {
      return err({
        type: 'wrong-peer-association',
        expected: peer.peer_association_id,
        actual: claims[BVAD_CLAIM_ASSOCIATION],
      });
    }

    const lifetime = this.config.lifetimeSeconds ?? BVAD_LIFETIME_SECONDS;
    const newClaims: BvadClaims & { 'https://bdi.nl/claims/federation'?: unknown } = {
      iss: this.config.issuer,
      sub: claims.sub,
      aud: input.audience,
      iat: now,
      exp: now + lifetime,
      jti: this.ids.newUuid(),
      [BVAD_CLAIM_ASSOCIATION]: peer.association_id,
      [BVAD_CLAIM_ORGANISATION]: claims[BVAD_CLAIM_ORGANISATION],
      [BVAD_CLAIM_CONNECTOR]: claims[BVAD_CLAIM_CONNECTOR],
      [BVAD_CLAIM_ASSURANCE]: claims[BVAD_CLAIM_ASSURANCE],
      [BVAD_CLAIM_STATUS]: claims[BVAD_CLAIM_STATUS],
      'https://bdi.nl/claims/federation': {
        peer_issuer: peer.peer_issuer,
        peer_jti: claims.jti,
        peer_association: peer.peer_association_id,
      },
    };

    const jws = await this.signer.signJwt(newClaims);
    await this.bus.publish('asr.federation.token-exchanged', peer.association_id, {
      peer_iss: peer.peer_issuer,
      peer_jti: claims.jti,
      local_jti: newClaims.jti,
      audience: input.audience,
      scope: input.scope,
    });
    return ok(jws);
  }

  private extractIssuer(compact: string): string | null {
    const parts = compact.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = parts[1]!;
      const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((payload.length + 3) % 4);
      const json = JSON.parse(atob(padded)) as { iss?: unknown };
      return typeof json.iss === 'string' ? json.iss : null;
    } catch {
      return null;
    }
  }
}

export type { Jwk };
