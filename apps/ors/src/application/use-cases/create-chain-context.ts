// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  err,
  ok,
  parseChainContextId,
  type AssociationId,
  type ChainContextId,
  type Euid,
  type Result,
} from '@transportial/kernel';
import {
  createChainContext,
  type ChainContextKind,
  type ContextIdentifier,
} from '../../domain/model/chain-context.ts';
import type {
  ChainContextRepository,
  ClockPort,
  EventBusPort,
  IdPort,
} from '../ports.ts';

export interface CreateChainContextInput {
  readonly association_id: AssociationId;
  readonly orchestrator: Euid;
  readonly kind: ChainContextKind;
  readonly identifiers: ReadonlyArray<ContextIdentifier>;
  readonly valid_from: string;
  readonly valid_until: string | null;
}

export type CreateChainContextError = { type: 'bad-id-generator' };

export class CreateChainContextUseCase {
  constructor(
    private readonly contexts: ChainContextRepository,
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(
    input: CreateChainContextInput,
  ): Promise<Result<{ chainContextId: ChainContextId }, CreateChainContextError>> {
    const raw = this.ids.newUuid();
    const parsed = parseChainContextId(raw);
    if (!parsed.ok) return err({ type: 'bad-id-generator' });

    const ctx = createChainContext({
      id: parsed.value,
      association_id: input.association_id,
      orchestrator_member_id: input.orchestrator,
      kind: input.kind,
      identifiers: input.identifiers,
      valid_from: input.valid_from,
      valid_until: input.valid_until,
      created_at: this.clock.nowIso(),
    });
    await this.contexts.save(ctx);
    await this.bus.publish('ors.context.created', input.association_id, {
      chain_context_id: parsed.value,
      orchestrator: input.orchestrator,
    });
    return ok({ chainContextId: parsed.value });
  }
}
