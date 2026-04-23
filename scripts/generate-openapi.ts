#!/usr/bin/env bun
// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Stichting Connekt and contributors

// Generates per-service OpenAPI 3.1 documents (JSON + YAML) into docs/api/.
// Run as: `bun run scripts/generate-openapi.ts` — the result is a static
// set of files that operators can ship alongside their service images.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOpenApi,
  commonSchemas,
  commonSecuritySchemes,
  toYaml,
  type OperationSpec,
} from '@bdi/openapi';

const outDir = join(import.meta.dir ?? process.cwd(), '..', 'docs', 'api');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

function emit(name: string, operations: ReadonlyArray<OperationSpec>, title: string): void {
  const doc = buildOpenApi({
    title,
    version: '0.1.0',
    description: `Generated OpenAPI specification for ${name}. See the BDI reference implementation for wire-format details.`,
    servers: [{ url: 'http://localhost:8080', description: 'local-dev' }],
    components: { schemas: commonSchemas, securitySchemes: commonSecuritySchemes },
    operations,
    tags: [{ name: 'bdi', description: 'BDI core operations' }],
  });
  const jsonPath = join(outDir, `${name}.json`);
  const yamlPath = join(outDir, `${name}.yaml`);
  writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(yamlPath, `${toYaml(doc)}\n`);
}

const asrOperations: OperationSpec[] = [
  {
    method: 'POST',
    path: '/admin/members',
    operationId: 'startOnboarding',
    summary: 'Create a draft member',
    tags: ['bdi', 'members'],
    requestBody: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        required: ['euid', 'association_id', 'legal_name'],
        properties: {
          euid: { $ref: '#/components/schemas/Euid' },
          association_id: { $ref: '#/components/schemas/AssociationId' },
          legal_name: { type: 'string' },
          vat_number: { type: 'string' },
          lei: { type: 'string' },
        },
      },
    },
    responses: [
      { status: 201, description: 'Created' },
      { status: 400, description: 'Bad input', schema: { $ref: '#/components/schemas/ErrorResponse' } },
      { status: 409, description: 'Duplicate' },
    ],
  },
  {
    method: 'POST',
    path: '/admin/members/:id/run-verifications',
    operationId: 'runVerifications',
    summary: 'Run authoritative-register verifications',
    tags: ['bdi', 'members'],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: [{ status: 202, description: 'Accepted' }],
  },
  {
    method: 'POST',
    path: '/admin/members/:id/approve',
    operationId: 'approveMember',
    summary: 'Record a 4-eyes approval',
    tags: ['bdi', 'members'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        required: ['approver'],
        properties: { approver: { type: 'string' } },
      },
    },
    responses: [{ status: 200, description: 'Approved' }],
  },
  {
    method: 'POST',
    path: '/oauth2/token',
    operationId: 'issueToken',
    summary: 'OAuth 2.0 client_credentials + token-exchange',
    tags: ['bdi', 'oauth'],
    requestBody: {
      contentType: 'application/x-www-form-urlencoded',
      schema: {
        type: 'object',
        properties: {
          grant_type: { type: 'string' },
          client_id: { type: 'string' },
          client_assertion_type: { type: 'string' },
          client_assertion: { type: 'string' },
          audience: { type: 'string' },
          scope: { type: 'string' },
        },
      },
    },
    responses: [
      {
        status: 200,
        description: 'BVAD issued',
        schema: {
          type: 'object',
          required: ['access_token', 'token_type', 'expires_in'],
          properties: {
            access_token: { type: 'string' },
            token_type: { type: 'string', enum: ['Bearer'] },
            expires_in: { type: 'integer' },
          },
        },
      },
      { status: 401, description: 'Invalid client or assertion' },
    ],
  },
  {
    method: 'GET',
    path: '/.well-known/jwks.json',
    operationId: 'jwks',
    summary: 'Published signing keys',
    tags: ['bdi'],
    responses: [{ status: 200, description: 'JWKS', schema: { type: 'object' } }],
  },
  {
    method: 'GET',
    path: '/.well-known/bdi/trustlist/:association',
    operationId: 'trustlist',
    summary: 'Signed association trustlist',
    tags: ['bdi'],
    parameters: [
      { name: 'association', in: 'path', required: true, schema: { $ref: '#/components/schemas/AssociationId' } },
    ],
    responses: [{ status: 200, description: 'Trustlist JWS', contentType: 'application/jose' }],
  },
  {
    method: 'GET',
    path: '/.well-known/bdi/members/:euid',
    operationId: 'memberDescriptor',
    summary: 'Signed member descriptor',
    tags: ['bdi'],
    parameters: [
      { name: 'euid', in: 'path', required: true, schema: { $ref: '#/components/schemas/Euid' } },
    ],
    responses: [{ status: 200, description: 'Member descriptor JWS', contentType: 'application/jose' }],
  },
  {
    method: 'GET',
    path: '/acme/directory',
    operationId: 'acmeDirectory',
    summary: 'ACME v2 directory (RFC 8555)',
    tags: ['bdi', 'acme'],
    responses: [{ status: 200, description: 'Directory document', schema: { type: 'object' } }],
  },
  {
    method: 'GET',
    path: '/metrics',
    operationId: 'metrics',
    summary: 'Prometheus exposition',
    tags: ['ops'],
    responses: [{ status: 200, description: 'text/plain', contentType: 'text/plain; version=0.0.4' }],
  },
];

const orsOperations: OperationSpec[] = [
  {
    method: 'POST',
    path: '/contexts',
    operationId: 'createChainContext',
    summary: 'Create a chain context',
    tags: ['bdi', 'contexts'],
    requestBody: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        required: ['association_id', 'orchestrator', 'kind'],
        properties: {
          association_id: { $ref: '#/components/schemas/AssociationId' },
          orchestrator: { $ref: '#/components/schemas/Euid' },
          kind: { type: 'string', enum: ['order', 'transport', 'shipment', 'custom'] },
          identifiers: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    responses: [{ status: 201, description: 'Created' }],
  },
  {
    method: 'POST',
    path: '/contexts/:id/parties',
    operationId: 'addParty',
    summary: 'Add an involved party',
    tags: ['bdi', 'contexts'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ChainContextId' } }],
    requestBody: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        required: ['actor', 'member_euid', 'roles'],
        properties: {
          actor: { $ref: '#/components/schemas/Euid' },
          member_euid: { $ref: '#/components/schemas/Euid' },
          roles: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    responses: [{ status: 201, description: 'Added' }],
  },
  {
    method: 'POST',
    path: '/contexts/:id/bvod',
    operationId: 'issueBvod',
    summary: 'Issue a BVOD',
    tags: ['bdi', 'contexts'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ChainContextId' } }],
    responses: [{ status: 200, description: 'BVOD JWS' }],
  },
];

const conOperations: OperationSpec[] = [
  {
    method: 'POST',
    path: '/proxy/check',
    operationId: 'proxyCheck',
    summary: 'Verify BVAD + BVOD + local policy for a prospective request',
    tags: ['bdi', 'proxy'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          resource: { type: 'object' },
        },
      },
    },
    responses: [{ status: 200, description: 'Permit' }],
  },
  {
    method: 'POST',
    path: '/webhooks/inbound',
    operationId: 'inboundWebhook',
    summary: 'Accept a signed webhook from an allowed issuer',
    tags: ['bdi', 'webhooks'],
    requestBody: { contentType: 'application/json', schema: { type: 'object' } },
    responses: [{ status: 202, description: 'Accepted' }],
  },
  {
    method: 'POST',
    path: '/webhooks/outbound',
    operationId: 'outboundWebhook',
    summary: 'Enqueue an outbound webhook delivery',
    tags: ['bdi', 'webhooks'],
    requestBody: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        required: ['target_url', 'event_id', 'event_type'],
        properties: {
          target_url: { type: 'string' },
          event_id: { type: 'string' },
          event_type: { type: 'string' },
          payload: { type: 'object' },
        },
      },
    },
    responses: [{ status: 202, description: 'Queued' }],
  },
  {
    method: 'GET',
    path: '/metrics',
    operationId: 'metrics',
    summary: 'Prometheus exposition',
    tags: ['ops'],
    responses: [{ status: 200, description: 'Prometheus text', contentType: 'text/plain' }],
  },
];

emit('asr', asrOperations, 'BDI Associatie Register API');
emit('ors', orsOperations, 'BDI Orkestratie Register API');
emit('con', conOperations, 'BDI Connector API');

// eslint-disable-next-line no-console
console.log(`Wrote OpenAPI specs to ${outDir}`);
