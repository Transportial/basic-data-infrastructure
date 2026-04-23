// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Transportial and contributors

export type JsonSchema =
  | { type: 'string'; format?: string; enum?: ReadonlyArray<string>; pattern?: string; description?: string }
  | { type: 'number' | 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | { type: 'null' }
  | {
      type: 'array';
      items: JsonSchema;
      description?: string;
      minItems?: number;
      maxItems?: number;
    }
  | {
      type: 'object';
      properties?: Readonly<Record<string, JsonSchema>>;
      required?: ReadonlyArray<string>;
      description?: string;
      additionalProperties?: boolean | JsonSchema;
    }
  | { oneOf: ReadonlyArray<JsonSchema> }
  | { anyOf: ReadonlyArray<JsonSchema> }
  | { allOf: ReadonlyArray<JsonSchema> }
  | { $ref: string };

export interface Parameter {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required?: boolean;
  readonly schema: JsonSchema;
  readonly description?: string;
}

export interface RequestBody {
  readonly contentType: string;
  readonly schema: JsonSchema;
  readonly required?: boolean;
  readonly description?: string;
}

export interface ResponseSpec {
  readonly status: number;
  readonly description: string;
  readonly contentType?: string;
  readonly schema?: JsonSchema;
  readonly headers?: Readonly<Record<string, { description?: string; schema: JsonSchema }>>;
}

export interface OperationSpec {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly parameters?: ReadonlyArray<Parameter>;
  readonly requestBody?: RequestBody;
  readonly responses: ReadonlyArray<ResponseSpec>;
  readonly security?: ReadonlyArray<Readonly<Record<string, ReadonlyArray<string>>>>;
}

export interface OpenApiConfig {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly servers?: ReadonlyArray<{ url: string; description?: string }>;
  readonly operations: ReadonlyArray<OperationSpec>;
  readonly components?: {
    readonly schemas?: Readonly<Record<string, JsonSchema>>;
    readonly securitySchemes?: Readonly<Record<string, unknown>>;
  };
  readonly tags?: ReadonlyArray<{ name: string; description?: string }>;
}

// Build a complete OpenAPI 3.1 document from a flat list of operations.
// Operations share a template-style path syntax (`/foo/:id`) that we translate
// to OpenAPI's `{id}` form, and we merge operations targeting the same path
// under a single PathItem entry.
export function buildOpenApi(cfg: OpenApiConfig): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of cfg.operations) {
    const oasPath = op.path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
    const entry = paths[oasPath] ?? (paths[oasPath] = {});
    entry[op.method.toLowerCase()] = {
      operationId: op.operationId,
      summary: op.summary,
      ...(op.description !== undefined ? { description: op.description } : {}),
      ...(op.tags !== undefined ? { tags: op.tags } : {}),
      ...(op.parameters ? { parameters: op.parameters } : {}),
      ...(op.requestBody
        ? {
            requestBody: {
              required: op.requestBody.required ?? true,
              ...(op.requestBody.description !== undefined
                ? { description: op.requestBody.description }
                : {}),
              content: {
                [op.requestBody.contentType]: { schema: op.requestBody.schema },
              },
            },
          }
        : {}),
      ...(op.security ? { security: op.security } : {}),
      responses: op.responses.reduce<Record<string, unknown>>((acc, r) => {
        acc[String(r.status)] = {
          description: r.description,
          ...(r.schema
            ? {
                content: {
                  [r.contentType ?? 'application/json']: { schema: r.schema },
                },
              }
            : {}),
          ...(r.headers ? { headers: r.headers } : {}),
        };
        return acc;
      }, {}),
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: cfg.title,
      version: cfg.version,
      ...(cfg.description !== undefined ? { description: cfg.description } : {}),
    },
    ...(cfg.servers ? { servers: cfg.servers } : {}),
    ...(cfg.tags ? { tags: cfg.tags } : {}),
    paths,
    ...(cfg.components ? { components: cfg.components } : {}),
  };
}

// Common BDI schemas and security schemes that the per-service specs
// reference. Keeping them in one place means the three services emit
// consistent problem-JSON shapes and share the `bearerAuth` scheme.
export const commonSchemas = {
  Euid: {
    type: 'string',
    pattern: '^[A-Z]{2}\\.[A-Z]+\\.[A-Z0-9-]+$',
    description: 'EUID — country.register.localId',
  },
  AssociationId: { type: 'string', pattern: '^[a-z][a-z0-9_-]{1,31}$' },
  ConnectorId: {
    type: 'string',
    pattern: '^urn:bdi:connector:[0-9a-f-]{36}$',
  },
  ChainContextId: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
  Assurance: { type: 'string', enum: ['substantial', 'high'] },
  MemberStatus: {
    type: 'string',
    enum: ['draft', 'verified', 'activated', 'suspended', 'revoked'],
  },
  ErrorResponse: {
    type: 'object',
    required: ['error'],
    properties: {
      error: { type: 'string' },
      detail: { type: 'string' },
    },
  },
} satisfies Record<string, JsonSchema>;

export const commonSecuritySchemes = {
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  },
  oauth2: {
    type: 'oauth2',
    flows: {
      clientCredentials: {
        tokenUrl: '/oauth2/token',
        scopes: {},
      },
    },
  },
} as const;

// Small YAML renderer — good enough for our nested JSON-compatible structures.
// We use it when tools need YAML rather than JSON (e.g. Redocly, Swagger UI).
export function toYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (value === null || value === undefined) return `${pad}null`;
  if (typeof value === 'string') {
    return needsQuotes(value) ? `${JSON.stringify(value)}` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((v) => `${pad}- ${renderInline(v, indent + 2)}`)
      .join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, v]) => {
        const rendered = isContainer(v) ? `\n${toYaml(v, indent + 2)}` : ` ${renderScalar(v)}`;
        return `${pad}${k}:${rendered}`;
      })
      .join('\n');
  }
  return String(value);
}

function renderInline(v: unknown, indent: number): string {
  if (isContainer(v)) {
    return `\n${toYaml(v, indent)}`;
  }
  return renderScalar(v);
}

function renderScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return needsQuotes(v) ? JSON.stringify(v) : v;
  return String(v);
}

function isContainer(v: unknown): boolean {
  return (typeof v === 'object' && v !== null) || Array.isArray(v);
}

function needsQuotes(s: string): boolean {
  return (
    s === '' ||
    /^[\d-]/.test(s) ||
    /[:#{}[\],&*!|>'"%@`]/.test(s) ||
    /\s$/.test(s) ||
    /^(true|false|null|yes|no)$/i.test(s)
  );
}
