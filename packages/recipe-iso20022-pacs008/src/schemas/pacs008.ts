// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Pinned snapshot of the ISO 20022 pacs.008 (FIToFICustomerCreditTransfer)
// message structure used for financial settlement along a trade-finance
// chain. Sourced from https://www.iso20022.org/. This file captures only
// the elements the bundled validator needs to do a structural pre-check at
// the connector boundary; production deployments that want full XSD or
// JSON-Schema validation should plug in their own validator backed by the
// upstream message definition.

// The message definition identifier this recipe is pinned to. The connector
// surfaces it as a resource tag so policy can pin to a specific revision.
export const PACS008_MESSAGE_DEFINITION = 'pacs.008.001.10' as const;

// JSON projections of ISO 20022 messages typically wrap the message body
// under the `Document` element, with the message-specific block nested
// inside it. For pacs.008 that block is `FIToFICstmrCdtTrf` containing a
// `GrpHdr` and one-or-more `CdtTrfTxInf` entries.
export const PACS008_DOCUMENT_KEY = 'Document' as const;
export const PACS008_BODY_KEY = 'FIToFICstmrCdtTrf' as const;
export const PACS008_GROUP_HEADER_KEY = 'GrpHdr' as const;
export const PACS008_TX_INFO_KEY = 'CdtTrfTxInf' as const;

// Required group-header fields per the pacs.008.001.10 schema. We restrict
// the structural check to what the connector can verify cheaply without
// pulling in a full code-list resolver.
export const PACS008_GROUP_HEADER_REQUIRED = ['MsgId', 'CreDtTm', 'NbOfTxs', 'SttlmInf'] as const;

// Required transaction-info fields per the pacs.008.001.10 schema, narrowed
// to what makes a single credit-transfer transaction structurally well
// formed: a payment id with end-to-end reference, the interbank settlement
// amount, the debtor and creditor (and their agents). Code lists, country
// codes and BICs are not validated here.
export const PACS008_TX_INFO_REQUIRED = [
  'PmtId',
  'IntrBkSttlmAmt',
  'ChrgBr',
  'Dbtr',
  'DbtrAgt',
  'Cdtr',
  'CdtrAgt',
] as const;
