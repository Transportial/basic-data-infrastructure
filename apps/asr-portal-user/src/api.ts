// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

// User-facing ASR client: the portal collects organisation details, submits
// the onboarding request, and polls the member's status. All reads happen
// via the public admin endpoints; a production deployment gates these with
// the portal's OIDC session.

export interface OnboardingInput {
  readonly euid: string;
  readonly legal_name: string;
  readonly vat_number?: string;
  readonly lei?: string;
  readonly signing_representative: {
    readonly subject_id: string;
    readonly auth_source: 'eHerkenning' | 'eIDAS' | 'manual';
    readonly assurance: 'substantial' | 'high';
    readonly verified_at: string;
  };
}

export interface OnboardingResult {
  readonly memberId: string;
}

export class UserAsrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly associationId: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async startOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
    const res = await this.fetcher(`${this.baseUrl}/admin/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, association_id: this.associationId }),
    });
    if (!res.ok) throw await toError(res);
    const body = (await res.json()) as { member_id: string };
    return { memberId: body.member_id };
  }

  async triggerVerifications(memberId: string): Promise<void> {
    const res = await this.fetcher(
      `${this.baseUrl}/admin/members/${memberId}/run-verifications`,
      { method: 'POST' },
    );
    if (!res.ok) throw await toError(res);
  }

  async fetchMemberDescriptor(euid: string): Promise<string> {
    const res = await this.fetcher(`${this.baseUrl}/.well-known/bdi/members/${euid}`);
    if (!res.ok) throw await toError(res);
    return res.text();
  }
}

async function toError(res: Response): Promise<Error> {
  const text = await res.text();
  return new Error(`${res.status}: ${text}`);
}
