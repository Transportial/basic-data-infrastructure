// SPDX-License-Identifier: EUPL-1.2 AND Apache-2.0
// Copyright (C) 2026 Stichting Connekt and contributors

import { ok, type Result } from '@bdi/kernel';
import { fail, isObject, type ValidationIssue } from '../validator.ts';

export type Service = 'asr' | 'ors' | 'con';

export interface EventEnvelope<TBody = unknown> {
  readonly id: string;
  readonly occurred_at: string;
  readonly producer: {
    readonly service: Service;
    readonly instance: string;
    readonly version: string;
  };
  readonly association_id: string;
  readonly type: string;
  readonly schema_version: 1;
  readonly trace: {
    readonly trace_id: string;
    readonly span_id: string;
  };
  readonly body: TBody;
  readonly signature?: {
    readonly jws: string;
    readonly kid: string;
  };
}

export function validateEnvelope<T = unknown>(
  raw: unknown,
  bodyValidator?: (b: unknown) => Result<T, ValidationIssue[]>,
): Result<EventEnvelope<T>, ValidationIssue[]> {
  if (!isObject(raw)) return fail([], 'not an object');
  const issues: ValidationIssue[] = [];
  const add = (cond: boolean, path: (string | number)[], msg: string) => {
    if (!cond) issues.push({ path, reason: msg });
  };
  add(typeof raw.id === 'string', ['id'], 'must be string');
  add(typeof raw.occurred_at === 'string', ['occurred_at'], 'must be string');
  add(isObject(raw.producer), ['producer'], 'must be object');
  if (isObject(raw.producer)) {
    add(
      raw.producer.service === 'asr' || raw.producer.service === 'ors' || raw.producer.service === 'con',
      ['producer', 'service'],
      'must be asr|ors|con',
    );
    add(typeof raw.producer.instance === 'string', ['producer', 'instance'], 'must be string');
    add(typeof raw.producer.version === 'string', ['producer', 'version'], 'must be string');
  }
  add(typeof raw.association_id === 'string', ['association_id'], 'must be string');
  add(typeof raw.type === 'string', ['type'], 'must be string');
  add(raw.schema_version === 1, ['schema_version'], 'must be 1');
  add(isObject(raw.trace), ['trace'], 'must be object');
  if (isObject(raw.trace)) {
    add(typeof raw.trace.trace_id === 'string', ['trace', 'trace_id'], 'must be string');
    add(typeof raw.trace.span_id === 'string', ['trace', 'span_id'], 'must be string');
  }
  if (raw.body === undefined) {
    issues.push({ path: ['body'], reason: 'required' });
  }
  if (issues.length > 0) return { ok: false, error: issues };
  if (bodyValidator) {
    const bodyResult = bodyValidator(raw.body);
    if (!bodyResult.ok) {
      return { ok: false, error: bodyResult.error.map((i) => ({ ...i, path: ['body', ...i.path] })) };
    }
    return ok({ ...(raw as object), body: bodyResult.value } as unknown as EventEnvelope<T>);
  }
  return ok(raw as unknown as EventEnvelope<T>);
}

export const AsrEventTypes = {
  MEMBER_DRAFT_CREATED: 'asr.member.draft-created',
  MEMBER_VERIFIED: 'asr.member.verified',
  MEMBER_ACTIVATED: 'asr.member.activated',
  MEMBER_SUSPENDED: 'asr.member.suspended',
  MEMBER_REVOKED: 'asr.member.revoked',
  CONNECTOR_REGISTERED: 'asr.connector.registered',
  CERTIFICATE_ISSUED: 'asr.certificate.issued',
  CERTIFICATE_REVOKED: 'asr.certificate.revoked',
  KEYS_ROTATED: 'asr.keys.rotated',
  TRUSTLIST_UPDATED: 'asr.trustlist.updated',
} as const;

export const OrsEventTypes = {
  CONTEXT_CREATED: 'ors.context.created',
  CONTEXT_PARTY_ADDED: 'ors.context.party-added',
  CONTEXT_PARTY_REMOVED: 'ors.context.party-removed',
  CONTEXT_EVENT_OCCURRED: 'ors.context.event-occurred',
  CONTEXT_COMPLETED: 'ors.context.completed',
} as const;

export const ConEventTypes = {
  WEBHOOK_DELIVERED: 'con.webhook.delivered',
  WEBHOOK_FAILED: 'con.webhook.failed',
  WEBHOOK_DEAD_LETTERED: 'con.webhook.dead-lettered',
  SIGNATURE_VERIFIED: 'con.signature.verified',
} as const;

export type AsrEventType = (typeof AsrEventTypes)[keyof typeof AsrEventTypes];
export type OrsEventType = (typeof OrsEventTypes)[keyof typeof OrsEventTypes];
export type ConEventType = (typeof ConEventTypes)[keyof typeof ConEventTypes];
