// SPDX-License-Identifier: EUPL-1.2
import { describe, test, expect } from 'bun:test';
import {
  parseEuid,
  isEuid,
  euidCountry,
  euidRegister,
  euidLocalId,
  type Euid,
} from '../src/identifiers/euid.ts';
import { parseLei, isLei, verifyLeiChecksum } from '../src/identifiers/lei.ts';
import { parseVat, isVat } from '../src/identifiers/vat-number.ts';
import { parseKvk, isKvk } from '../src/identifiers/kvk-number.ts';
import { parseKbo, isKbo } from '../src/identifiers/kbo-number.ts';
import { parseAssociationId, isAssociationId } from '../src/identifiers/association-id.ts';
import {
  parseConnectorId,
  makeConnectorId,
  isConnectorId,
} from '../src/identifiers/connector-id.ts';
import {
  parseChainContextId,
  isChainContextId,
} from '../src/identifiers/chain-context-id.ts';

describe('Euid', () => {
  test('parses valid NL EUID', () => {
    const r = parseEuid('NL.NHR.12345678');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('NL.NHR.12345678' as Euid);
  });

  test('rejects empty string', () => {
    const r = parseEuid('');
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects bad format', () => {
    const r = parseEuid('NL-NHR-12345678');
    expect(!r.ok && r.error.type).toBe('bad-format');
  });

  test('rejects unknown country', () => {
    const r = parseEuid('XX.NHR.12345678');
    expect(!r.ok && r.error.type).toBe('unknown-country');
  });

  test('isEuid returns true for valid', () => {
    expect(isEuid('BE.KBO.0400378485')).toBe(true);
  });

  test('isEuid returns false for non-string', () => {
    expect(isEuid(123)).toBe(false);
    expect(isEuid(null)).toBe(false);
    expect(isEuid({})).toBe(false);
  });

  test('isEuid returns false for invalid string', () => {
    expect(isEuid('invalid')).toBe(false);
  });

  test('euidCountry extracts country code', () => {
    const r = parseEuid('NL.NHR.12345678');
    if (r.ok) expect(euidCountry(r.value)).toBe('NL');
  });

  test('euidRegister extracts register', () => {
    const r = parseEuid('NL.NHR.12345678');
    if (r.ok) expect(euidRegister(r.value)).toBe('NHR');
  });

  test('euidLocalId extracts local id', () => {
    const r = parseEuid('NL.NHR.12345678');
    if (r.ok) expect(euidLocalId(r.value)).toBe('12345678');
  });
});

describe('LEI', () => {
  // Known good LEI (Apple Inc): HWUPKR0MPOU8FGXBT394
  test('parses valid LEI', () => {
    const r = parseLei('HWUPKR0MPOU8FGXBT394');
    expect(r.ok).toBe(true);
  });

  test('rejects empty', () => {
    const r = parseLei('');
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects wrong length', () => {
    const r = parseLei('HWUPKR0MPOU8FGXBT3');
    expect(!r.ok && r.error.type).toBe('bad-length');
  });

  test('rejects non-alphanumeric chars', () => {
    const r = parseLei('HWUPKR0MPOU8FGXBT3!4');
    expect(!r.ok && r.error.type).toBe('bad-format');
  });

  test('rejects bad checksum', () => {
    const r = parseLei('HWUPKR0MPOU8FGXBT300');
    expect(!r.ok && r.error.type).toBe('bad-checksum');
  });

  test('verifyLeiChecksum accepts valid', () => {
    expect(verifyLeiChecksum('HWUPKR0MPOU8FGXBT394')).toBe(true);
  });

  test('verifyLeiChecksum rejects invalid char', () => {
    expect(verifyLeiChecksum('HWUPKR0MPOU8FGXBT39!')).toBe(false);
  });

  test('isLei narrows correctly', () => {
    expect(isLei('HWUPKR0MPOU8FGXBT394')).toBe(true);
    expect(isLei(42)).toBe(false);
    expect(isLei('bad')).toBe(false);
  });
});

describe('VAT', () => {
  test('parses valid NL VAT', () => {
    const r = parseVat('NL123456789B01');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('NL123456789B01');
  });

  test('normalises whitespace and case', () => {
    const r = parseVat('nl 123456789 b01');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('NL123456789B01');
  });

  test('rejects empty', () => {
    const r = parseVat('');
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects bad format', () => {
    const r = parseVat('NL-!');
    expect(!r.ok && r.error.type).toBe('bad-format');
  });

  test('rejects unknown country', () => {
    const r = parseVat('US123456789');
    expect(!r.ok && r.error.type).toBe('unknown-country');
  });

  test('isVat', () => {
    expect(isVat('NL123456789B01')).toBe(true);
    expect(isVat(123)).toBe(false);
  });
});

describe('KvK', () => {
  test('parses 8-digit KvK', () => {
    const r = parseKvk('12345678');
    expect(r.ok).toBe(true);
  });

  test('rejects empty', () => {
    const r = parseKvk('');
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects wrong length', () => {
    const r = parseKvk('123');
    expect(!r.ok && r.error.type).toBe('bad-length');
  });

  test('rejects non-numeric', () => {
    const r = parseKvk('1234567a');
    expect(!r.ok && r.error.type).toBe('not-numeric');
  });

  test('isKvk', () => {
    expect(isKvk('12345678')).toBe(true);
    expect(isKvk(12345678)).toBe(false);
  });
});

describe('KBO', () => {
  // 0400.378.485 is a well-known Belgian KBO (check digit math: 0400378485, 04003784 mod 97 = 30, 97-30=67? let's compute)
  // Let's generate a valid one: take 04003784 -> mod 97
  // 4003784 % 97 ... we'll just test the algorithm and reject paths
  test('rejects empty', () => {
    const r = parseKbo('');
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects wrong length', () => {
    const r = parseKbo('12345');
    expect(!r.ok && r.error.type).toBe('bad-length');
  });

  test('rejects non-numeric', () => {
    const r = parseKbo('123456789a');
    expect(!r.ok && r.error.type).toBe('not-numeric');
  });

  test('accepts known valid KBO with proper checksum', () => {
    // Compute valid KBO: base 04003784, 04003784 mod 97 = ?
    const base = 4003784;
    const check = 97 - (base % 97);
    const digits = `04003784${check.toString().padStart(2, '0')}`;
    const r = parseKbo(digits);
    expect(r.ok).toBe(true);
  });

  test('strips dot separators', () => {
    // 0400378485 is valid; displayed form is 0400.378.485
    const r = parseKbo('0400.378.485');
    expect(r.ok).toBe(true);
  });

  test('rejects bad checksum', () => {
    const r = parseKbo('0400378400');
    expect(!r.ok && r.error.type).toBe('bad-checksum');
  });

  test('isKbo', () => {
    const base = 4003784;
    const check = 97 - (base % 97);
    const digits = `04003784${check.toString().padStart(2, '0')}`;
    expect(isKbo(digits)).toBe(true);
    expect(isKbo(42)).toBe(false);
  });
});

describe('AssociationId', () => {
  test('accepts well-formed id', () => {
    const r = parseAssociationId('ctn');
    expect(r.ok).toBe(true);
  });

  test('accepts id with dashes and numbers', () => {
    const r = parseAssociationId('ctn-nl_01');
    expect(r.ok).toBe(true);
  });

  test('rejects empty', () => {
    const r = parseAssociationId('');
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects uppercase', () => {
    const r = parseAssociationId('CTN');
    expect(!r.ok && r.error.type).toBe('bad-format');
  });

  test('rejects too long', () => {
    const r = parseAssociationId('a'.repeat(33));
    expect(!r.ok && r.error.type).toBe('bad-format');
  });

  test('isAssociationId', () => {
    expect(isAssociationId('ctn')).toBe(true);
    expect(isAssociationId(42)).toBe(false);
  });
});

describe('ConnectorId', () => {
  const validUuid = '9f3a2c10-1234-4abc-89ab-cdef01234567';

  test('parses urn:bdi:connector:<uuid>', () => {
    const r = parseConnectorId(`urn:bdi:connector:${validUuid}`);
    expect(r.ok).toBe(true);
  });

  test('rejects empty', () => {
    const r = parseConnectorId('');
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects wrong scheme', () => {
    const r = parseConnectorId(`urn:other:${validUuid}`);
    expect(!r.ok && r.error.type).toBe('bad-scheme');
  });

  test('rejects bad uuid', () => {
    const r = parseConnectorId('urn:bdi:connector:not-a-uuid');
    expect(!r.ok && r.error.type).toBe('bad-uuid');
  });

  test('makeConnectorId builds URN', () => {
    const r = makeConnectorId(validUuid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(`urn:bdi:connector:${validUuid}`);
  });

  test('isConnectorId', () => {
    expect(isConnectorId(`urn:bdi:connector:${validUuid}`)).toBe(true);
    expect(isConnectorId(42)).toBe(false);
  });
});

describe('ChainContextId', () => {
  const validUuid = '9f3a2c10-1234-4abc-89ab-cdef01234567';

  test('parses valid uuid', () => {
    const r = parseChainContextId(validUuid);
    expect(r.ok).toBe(true);
  });

  test('rejects empty', () => {
    const r = parseChainContextId('');
    expect(!r.ok && r.error.type).toBe('empty');
  });

  test('rejects non-uuid', () => {
    const r = parseChainContextId('hello');
    expect(!r.ok && r.error.type).toBe('bad-uuid');
  });

  test('lowercases', () => {
    const r = parseChainContextId(validUuid.toUpperCase());
    if (r.ok) expect(r.value).toBe(validUuid);
  });

  test('isChainContextId', () => {
    expect(isChainContextId(validUuid)).toBe(true);
    expect(isChainContextId(42)).toBe(false);
  });
});
