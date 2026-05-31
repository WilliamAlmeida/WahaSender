import { parse } from 'csv-parse/sync';

export interface CsvImportRow {
  name?: string;
  phone: string;
}

export interface CsvImportResult {
  rows: CsvImportRow[];
  total: number;
  invalid: number;
}

/**
 * Parses CSV text with explicit `phone` (mandatory) and optional `name`
 * column. Headers are case-insensitive and the user can remap via the
 * `mapping` argument when their CSV uses different names.
 */
export function parseContactsCsv(
  text: string,
  mapping?: { phone?: string; name?: string },
  options?: { delimiter?: string },
): CsvImportResult {
  const records = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    delimiter: options?.delimiter || ',',
    relax_quotes: true,
  }) as Record<string, string>[];

  const phoneKey = (mapping?.phone || 'phone').toLowerCase();
  const nameKey = (mapping?.name || 'name').toLowerCase();

  const rows: CsvImportRow[] = [];
  let invalid = 0;
  for (const r of records) {
    const phoneRaw = r[phoneKey] ?? r['telefone'] ?? r['celular'] ?? '';
    const phone = String(phoneRaw).replace(/\D/g, '').trim();
    if (!phone || phone.length < 8) {
      invalid++;
      continue;
    }
    rows.push({ phone, name: r[nameKey] ?? r['nome'] ?? undefined });
  }
  return { rows, total: records.length, invalid };
}
