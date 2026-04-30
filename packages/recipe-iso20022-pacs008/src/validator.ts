// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

import {
  PACS008_BODY_KEY,
  PACS008_DOCUMENT_KEY,
  PACS008_GROUP_HEADER_KEY,
  PACS008_GROUP_HEADER_REQUIRED,
  PACS008_MESSAGE_DEFINITION,
  PACS008_TX_INFO_KEY,
  PACS008_TX_INFO_REQUIRED,
} from './schemas/pacs008.ts';

export interface Pacs008ValidationOk {
  readonly ok: true;
  readonly messageDefinition: typeof PACS008_MESSAGE_DEFINITION;
  readonly msgId: string;
  readonly txCount: number;
  // Optional EndToEndId of the first transaction — useful as a routing tag
  // when downstream policies reason about a single underlying payment.
  readonly firstEndToEndId?: string;
}

export interface Pacs008ValidationErr {
  readonly ok: false;
  readonly errors: ReadonlyArray<string>;
}

export type Pacs008ValidationResult = Pacs008ValidationOk | Pacs008ValidationErr;

// Pacs008Validator is the recipe's validation seam. The bundled
// MinimalPacs008Validator does a structural check against the pinned
// pacs.008.001.10 message envelope; production users who want full
// XSD/JSON-Schema validation can implement this interface against the
// upstream message definition and inject it into the recipe.
export interface Pacs008Validator {
  readonly messageDefinition: string;
  validate(payload: unknown): Pacs008ValidationResult;
}

// MinimalPacs008Validator validates that a payload looks like a single
// pacs.008 FI-to-FI customer credit transfer envelope: it has Document >
// FIToFICstmrCdtTrf > GrpHdr (with the required header fields) and at least
// one CdtTrfTxInf entry (each carrying its required structural fields). It
// does NOT recurse into ISO 20022 code lists, BIC validation, or amount
// currency-code consistency. That is by design: the recipe is a fast
// structural gate, not a replacement for full schema validation.
export class MinimalPacs008Validator implements Pacs008Validator {
  readonly messageDefinition = PACS008_MESSAGE_DEFINITION;

  validate(payload: unknown): Pacs008ValidationResult {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['payload must be a JSON object'] };
    }
    const root = payload as Record<string, unknown>;
    const document = root[PACS008_DOCUMENT_KEY];
    if (!isObject(document)) {
      return { ok: false, errors: [`missing root '${PACS008_DOCUMENT_KEY}' object`] };
    }
    const body = document[PACS008_BODY_KEY];
    if (!isObject(body)) {
      return {
        ok: false,
        errors: [`missing '${PACS008_BODY_KEY}' under ${PACS008_DOCUMENT_KEY}`],
      };
    }

    const errors: string[] = [];
    const header = body[PACS008_GROUP_HEADER_KEY];
    let msgId = '';
    if (!isObject(header)) {
      errors.push(`missing '${PACS008_GROUP_HEADER_KEY}' under ${PACS008_BODY_KEY}`);
    } else {
      for (const field of PACS008_GROUP_HEADER_REQUIRED) {
        if (!(field in header)) {
          errors.push(`missing required ${PACS008_GROUP_HEADER_KEY} field '${field}'`);
        }
      }
      const id = header['MsgId'];
      if (typeof id !== 'string' || id.length === 0) {
        if (!errors.some((e) => e.includes("'MsgId'"))) {
          errors.push(`${PACS008_GROUP_HEADER_KEY}.MsgId must be a non-empty string`);
        }
      } else {
        msgId = id;
      }
    }

    const txField = body[PACS008_TX_INFO_KEY];
    const transactions = normaliseTxList(txField);
    if (transactions === null) {
      errors.push(
        `'${PACS008_TX_INFO_KEY}' must be a transaction object or a non-empty array of transaction objects`,
      );
    } else {
      for (const [i, tx] of transactions.entries()) {
        for (const field of PACS008_TX_INFO_REQUIRED) {
          if (!(field in tx)) {
            errors.push(`missing required ${PACS008_TX_INFO_KEY}[${i}] field '${field}'`);
          }
        }
      }
    }

    if (errors.length > 0) return { ok: false, errors };

    const txs = transactions as ReadonlyArray<Record<string, unknown>>;
    const result: Pacs008ValidationOk = {
      ok: true,
      messageDefinition: PACS008_MESSAGE_DEFINITION,
      msgId,
      txCount: txs.length,
      ...optionalEndToEndId(txs),
    };
    return result;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normaliseTxList(value: unknown): ReadonlyArray<Record<string, unknown>> | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (!value.every(isObject)) return null;
    return value as ReadonlyArray<Record<string, unknown>>;
  }
  if (isObject(value)) return [value];
  return null;
}

function optionalEndToEndId(
  txs: ReadonlyArray<Record<string, unknown>>,
): { readonly firstEndToEndId?: string } {
  const first = txs[0];
  if (!first) return {};
  const pmtId = first['PmtId'];
  if (!isObject(pmtId)) return {};
  const e2e = pmtId['EndToEndId'];
  return typeof e2e === 'string' && e2e.length > 0 ? { firstEndToEndId: e2e } : {};
}
