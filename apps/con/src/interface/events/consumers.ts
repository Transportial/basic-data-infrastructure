// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

import type { EventEnvelope } from '@bdi/contracts';
import type { InMemoryConsumer } from '@bdi/events';
import { InMemoryConsumer as Consumer } from '@bdi/events';
import type { TrustlistStore } from '../../infrastructure/trustlist-store.ts';

// Wire-up point for CON's reaction to cross-service events. The constructor
// accepts any number of upstream streams; each event type has a dedicated
// handler that mutates the local trustlist cache, invalidates BVOD cache
// entries, or rotates configuration. Built on top of the in-memory consumer
// from @bdi/events so tests can drive it deterministically, but production
// plugs in a ValkeyStreamConsumer via the same interface.

export interface BvodCache {
  invalidate(chainContextId: string): void;
  warm(chainContextId: string): void;
}

export class InMemoryBvodCache implements BvodCache {
  readonly invalidated = new Set<string>();
  readonly warmed = new Set<string>();
  invalidate(id: string): void {
    this.invalidated.add(id);
    this.warmed.delete(id);
  }
  warm(id: string): void {
    this.warmed.add(id);
    this.invalidated.delete(id);
  }
}

export interface MemberCache {
  invalidate(euid: string): void;
}

export class InMemoryMemberCache implements MemberCache {
  readonly invalidated = new Set<string>();
  invalidate(euid: string): void {
    this.invalidated.add(euid);
  }
}

export interface EventConsumerDeps {
  readonly trustlist: TrustlistStore;
  readonly bvodCache: BvodCache;
  readonly memberCache: MemberCache;
  readonly ownMemberEuid: string;
}

export function buildAsrEventConsumer(deps: EventConsumerDeps): InMemoryConsumer<unknown> {
  return new Consumer(async (envelope: EventEnvelope<unknown>) => {
    switch (envelope.type) {
      case 'asr.member.activated': {
        await deps.trustlist.refresh();
        break;
      }
      case 'asr.member.suspended':
      case 'asr.member.revoked': {
        const body = envelope.body as { euid?: string } | null;
        if (body?.euid) deps.memberCache.invalidate(body.euid);
        await deps.trustlist.refresh();
        break;
      }
      case 'asr.keys.rotated':
      case 'asr.trustlist.updated': {
        await deps.trustlist.refresh();
        break;
      }
      case 'asr.certificate.revoked': {
        await deps.trustlist.refresh();
        break;
      }
      default:
        // Unknown ASR events are acknowledged silently so producers can add new
        // event types without breaking older connectors.
        break;
    }
  });
}

export function buildOrsEventConsumer(deps: EventConsumerDeps): InMemoryConsumer<unknown> {
  return new Consumer(async (envelope: EventEnvelope<unknown>) => {
    switch (envelope.type) {
      case 'ors.context.party-added': {
        const body = envelope.body as { chain_context_id?: string; member_euid?: string } | null;
        if (body?.chain_context_id && body.member_euid === deps.ownMemberEuid) {
          deps.bvodCache.warm(body.chain_context_id);
        }
        break;
      }
      case 'ors.context.party-removed': {
        const body = envelope.body as { chain_context_id?: string } | null;
        if (body?.chain_context_id) deps.bvodCache.invalidate(body.chain_context_id);
        break;
      }
      case 'ors.context.completed':
      case 'ors.context.cancelled': {
        const body = envelope.body as { chain_context_id?: string } | null;
        if (body?.chain_context_id) deps.bvodCache.invalidate(body.chain_context_id);
        break;
      }
      default:
        break;
    }
  });
}
