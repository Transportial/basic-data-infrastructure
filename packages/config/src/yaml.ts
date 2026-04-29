// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copyright (C) 2026 Transportial and contributors

// Narrow YAML parser for configuration files. Supports:
// - mappings (indented `key: value` and `key:` on its own then nested block)
// - sequences (`- item` at the same indent as the parent mapping value)
// - scalars: strings (quoted and unquoted), integers, floats, booleans, null
// - nested maps and lists
// - comments starting with `#`
// Explicitly NOT supported: anchors/aliases, tags, flow style, multi-line
// strings. For anything more, operators plug in js-yaml or yaml.

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<YamlValue>
  | { readonly [k: string]: YamlValue };

export function parseYaml(source: string): YamlValue {
  const lines = source
    .split('\n')
    .map((line) => stripComment(line))
    .map((line, i) => ({ raw: line, indent: leadingSpaces(line), lineno: i + 1 }))
    .filter((l) => l.raw.trim().length > 0);
  if (lines.length === 0) return {};
  const { value } = parseBlock(lines, 0, lines[0]!.indent);
  return value;
}

function stripComment(line: string): string {
  // Preserve leading whitespace; strip # comments unless inside quotes.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

interface Line {
  readonly raw: string;
  readonly indent: number;
  readonly lineno: number;
}

function parseBlock(
  lines: ReadonlyArray<Line>,
  start: number,
  indent: number,
): { value: YamlValue; next: number } {
  if (start >= lines.length) return { value: null, next: start };
  const first = lines[start]!;
  if (first.indent < indent) return { value: null, next: start };
  if (first.raw.trimStart().startsWith('- ')) return parseSequence(lines, start, indent);
  return parseMapping(lines, start, indent);
}

function parseSequence(
  lines: ReadonlyArray<Line>,
  start: number,
  indent: number,
): { value: YamlValue; next: number } {
  const items: YamlValue[] = [];
  let i = start;
  while (i < lines.length && lines[i]!.indent === indent) {
    const line = lines[i]!;
    const content = line.raw.trimStart();
    if (!content.startsWith('- ') && content !== '-') break;
    const rest = content === '-' ? '' : content.slice(2).trim();
    if (rest === '') {
      const nested = parseBlock(lines, i + 1, indent + 2);
      items.push(nested.value);
      i = nested.next;
      continue;
    }
    if (rest.includes(': ') || rest.endsWith(':')) {
      // Inline "- key: value" shorthand opens a nested mapping.
      const pseudoLines: Line[] = [
        { raw: ' '.repeat(indent + 2) + rest, indent: indent + 2, lineno: line.lineno },
      ];
      let j = i + 1;
      while (j < lines.length && lines[j]!.indent > indent) {
        pseudoLines.push(lines[j]!);
        j++;
      }
      const nested = parseMapping(pseudoLines, 0, indent + 2);
      items.push(nested.value);
      i = j;
      continue;
    }
    items.push(parseScalar(rest));
    i++;
  }
  return { value: items, next: i };
}

function parseMapping(
  lines: ReadonlyArray<Line>,
  start: number,
  indent: number,
): { value: YamlValue; next: number } {
  const out: Record<string, YamlValue> = {};
  let i = start;
  while (i < lines.length && lines[i]!.indent === indent) {
    const line = lines[i]!;
    const content = line.raw.trimStart();
    if (content.startsWith('- ')) break;
    const colonIdx = findMapColon(content);
    if (colonIdx < 0) {
      throw new Error(`yaml line ${line.lineno}: expected 'key: value'`);
    }
    const key = content.slice(0, colonIdx).trim();
    const rest = content.slice(colonIdx + 1).trim();
    if (rest === '') {
      const childIndent = i + 1 < lines.length ? lines[i + 1]!.indent : indent + 2;
      if (childIndent > indent) {
        const nested = parseBlock(lines, i + 1, childIndent);
        out[unquote(key)] = nested.value;
        i = nested.next;
      } else {
        out[unquote(key)] = null;
        i++;
      }
    } else {
      out[unquote(key)] = parseScalar(rest);
      i++;
    }
  }
  return { value: out, next: i };
}

function findMapColon(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ':' && !inSingle && !inDouble) {
      if (i === line.length - 1 || line[i + 1] === ' ' || line[i + 1] === '\t') return i;
    }
  }
  return -1;
}

function parseScalar(text: string): YamlValue {
  const s = text.trim();
  if (s === '') return null;
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

function unquote(key: string): string {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return key.slice(1, -1);
  }
  return key;
}
