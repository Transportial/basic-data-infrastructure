// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import { err, ok, type Result } from '@transportial/kernel';

export interface Approval {
  readonly by: string;
  readonly at: string;
}

export type ApprovalState = 'pending' | 'first' | 'completed' | 'rejected';

export interface FourEyesApproval {
  readonly id: string;
  readonly subject_type: 'member_activation' | 'connector_registration';
  readonly subject_id: string;
  readonly state: ApprovalState;
  readonly first_approval: Approval | null;
  readonly second_approval: Approval | null;
  readonly created_at: string;
}

export type ApproveError =
  | { type: 'self-approval-forbidden'; by: string }
  | { type: 'already-complete' }
  | { type: 'rejected' }
  | { type: 'invalid-state'; state: ApprovalState };

export function approve(
  record: FourEyesApproval,
  approver: string,
  at: string,
): Result<FourEyesApproval, ApproveError> {
  if (record.state === 'completed') return err({ type: 'already-complete' });
  if (record.state === 'rejected') return err({ type: 'rejected' });
  if (record.state === 'pending') {
    return ok({
      ...record,
      state: 'first',
      first_approval: { by: approver, at },
    });
  }
  if (record.state === 'first') {
    if (record.first_approval?.by === approver) {
      return err({ type: 'self-approval-forbidden', by: approver });
    }
    return ok({
      ...record,
      state: 'completed',
      second_approval: { by: approver, at },
    });
  }
  return err({ type: 'invalid-state', state: record.state });
}

export function reject(record: FourEyesApproval): Result<FourEyesApproval, ApproveError> {
  if (record.state === 'completed') return err({ type: 'already-complete' });
  return ok({ ...record, state: 'rejected' });
}

export function isComplete(record: FourEyesApproval): boolean {
  return record.state === 'completed';
}
