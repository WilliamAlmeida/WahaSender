import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

export interface CsvImportRow {
  name?: string;
  phone: string;
}

export interface CsvImportResult {
  rows: CsvImportRow[];
  total: number;
  invalid: number;
}

function normalizeHeaders(headers: string[]): string[] {
  return headers.map((h) => String(h ?? '').trim().toLowerCase());
}

function extractRowsFromRecords(
  records: Record<string, string>[],
  mapping?: { phone?: string; name?: string },
): CsvImportResult {
  const phoneKey = (mapping?.phone || 'phone').toLowerCase();
  const nameKey = (mapping?.name || 'name').toLowerCase();

  const rows: CsvImportRow[] = [];
  let invalid = 0;
  for (const r of records) {
    const phoneRaw = r[phoneKey] ?? r['telefone'] ?? r['celular'] ?? r['fone'] ?? '';
    const phone = String(phoneRaw).replace(/\D/g, '').trim();
    if (!phone || phone.length < 8) {
      invalid++;
      continue;
    }
    rows.push({ phone, name: r[nameKey] ?? r['nome'] ?? undefined });
  }
  return { rows, total: records.length, invalid };
}

function parseXlsx(
  buffer: Buffer,
  mapping?: { phone?: string; name?: string },
): CsvImportResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], total: 0, invalid: 0 };
  const sheet = workbook.Sheets[sheetName];

  const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
  if (raw.length < 2) return { rows: [], total: 0, invalid: 0 };

  const headers = normalizeHeaders(raw[0] as string[]);
  const records: Record<string, string>[] = (raw.slice(1) as string[][])
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = String(row[i] ?? '').trim();
      });
      return obj;
    });

  return extractRowsFromRecords(records, mapping);
}

function parseCsv(
  text: string,
  mapping?: { phone?: string; name?: string },
  options?: { delimiter?: string },
): CsvImportResult {
  const records = parse(text, {
    columns: (header: string[]) => normalizeHeaders(header),
    skip_empty_lines: true,
    trim: true,
    delimiter: options?.delimiter || ',',
    relax_quotes: true,
  }) as Record<string, string>[];

  return extractRowsFromRecords(records, mapping);
}

function isXlsx(buffer: Buffer): boolean {
  // XLSX/ZIP magic bytes: PK\x03\x04
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export function parseContactsFile(
  buffer: Buffer,
  mapping?: { phone?: string; name?: string },
  options?: { delimiter?: string },
): CsvImportResult {
  if (isXlsx(buffer)) {
    return parseXlsx(buffer, mapping);
  }
  return parseCsv(buffer.toString('utf-8'), mapping, options);
}

// Keep legacy CSV-only export for backwards compat
export function parseContactsCsv(
  text: string,
  mapping?: { phone?: string; name?: string },
  options?: { delimiter?: string },
): CsvImportResult {
  return parseCsv(text, mapping, options);
}
