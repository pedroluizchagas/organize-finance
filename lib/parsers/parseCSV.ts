import { parse } from 'csv-parse/sync'
import type { ParsedTransaction } from './parseOFX'

export type { ParsedTransaction }

type RawRow = Record<string, string>

/**
 * Parses a CSV bank statement and returns normalized transactions.
 * Supports Nubank and Inter CSV formats with flexible column detection.
 */
export function parseCSV(fileBuffer: Buffer): ParsedTransaction[] {
  const content = fileBuffer.toString('utf-8')

  // Some Brazilian bank CSVs use semicolons or have BOM
  const cleaned = content.replace(/^\uFEFF/, '').trim()

  // Detect delimiter
  const delimiter = cleaned.includes(';') ? ';' : ','

  let rows: RawRow[]
  try {
    rows = parse(cleaned, {
      columns: true,
      delimiter,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as RawRow[]
  } catch {
    return []
  }

  if (rows.length === 0) return []

  const firstRow = rows[0]
  const columns = Object.keys(firstRow).map((k) => k.toLowerCase())

  // Detect format by column names
  if (isNubankFormat(columns)) return parseNubank(rows)
  if (isInterFormat(columns)) return parseInter(rows)

  // Fallback: generic detection
  return parseGeneric(rows, columns)
}

// ---------------------------------------------------------------------------
// Nubank format
// Columns: Data, Descrição, Valor
// ---------------------------------------------------------------------------

function isNubankFormat(columns: string[]): boolean {
  return columns.some((c) => c.includes('descrição') || c === 'descricao') &&
    columns.some((c) => c === 'valor') &&
    columns.some((c) => c === 'data')
}

function parseNubank(rows: RawRow[]): ParsedTransaction[] {
  return rows.flatMap((row) => {
    const rawDate = findValue(row, ['data'])
    const description = findValue(row, ['descrição', 'descricao', 'description'])
    const rawAmount = findValue(row, ['valor', 'value', 'amount'])

    if (!rawDate || !description || rawAmount === null) return []

    const date = parseBrazilianDate(rawDate)
    if (!date) return []

    // Nubank: negative = debit (expense), positive = credit (payment received)
    const amount = parseAmount(rawAmount)
    if (amount === null) return []

    const type: 'debit' | 'credit' = amount < 0 ? 'debit' : 'credit'

    return [{
      date,
      description: description.trim().toUpperCase(),
      amount: Math.abs(amount),
      type,
    }]
  })
}

// ---------------------------------------------------------------------------
// Inter format
// Columns: Data Lançamento, Histórico, Descrição, Valor, Saldo
// ---------------------------------------------------------------------------

function isInterFormat(columns: string[]): boolean {
  return columns.some((c) => c.includes('histórico') || c.includes('historico')) ||
    columns.some((c) => c.includes('lançamento') || c.includes('lancamento'))
}

function parseInter(rows: RawRow[]): ParsedTransaction[] {
  return rows.flatMap((row) => {
    const rawDate = findValue(row, ['data lançamento', 'data lancamento', 'data', 'date'])
    const description =
      findValue(row, ['descrição', 'descricao', 'description']) ??
      findValue(row, ['histórico', 'historico']) ?? ''
    const rawAmount = findValue(row, ['valor', 'value', 'amount'])
    const entryType = findValue(row, ['tipo lançamento', 'tipo lancamento', 'tipo', 'type'])

    if (!rawDate || rawAmount === null) return []

    const date = parseBrazilianDate(rawDate)
    if (!date) return []

    const amount = parseAmount(rawAmount)
    if (amount === null) return []

    // Inter uses D for debit and C for credit in the type column
    let type: 'debit' | 'credit'
    if (entryType) {
      type = entryType.toUpperCase().startsWith('D') ? 'debit' : 'credit'
    } else {
      type = amount < 0 ? 'debit' : 'credit'
    }

    return [{
      date,
      description: description.trim().toUpperCase(),
      amount: Math.abs(amount),
      type,
    }]
  })
}

// ---------------------------------------------------------------------------
// Generic fallback
// ---------------------------------------------------------------------------

function parseGeneric(rows: RawRow[], columns: string[]): ParsedTransaction[] {
  const dateCol = columns.find((c) => c.includes('data') || c.includes('date')) ?? columns[0]
  const descCol =
    columns.find((c) => c.includes('desc') || c.includes('memo') || c.includes('hist')) ??
    columns[1]
  const amtCol =
    columns.find((c) => c.includes('valor') || c.includes('amount') || c.includes('value')) ??
    columns[2]

  return rows.flatMap((row) => {
    const rawDate = row[Object.keys(row).find((k) => k.toLowerCase() === dateCol) ?? ''] ?? ''
    const description =
      row[Object.keys(row).find((k) => k.toLowerCase() === descCol) ?? ''] ?? ''
    const rawAmount =
      row[Object.keys(row).find((k) => k.toLowerCase() === amtCol) ?? ''] ?? ''

    const date = parseBrazilianDate(rawDate)
    if (!date) return []

    const amount = parseAmount(rawAmount)
    if (amount === null) return []

    const type: 'debit' | 'credit' = amount < 0 ? 'debit' : 'credit'

    return [{
      date,
      description: description.trim().toUpperCase(),
      amount: Math.abs(amount),
      type,
    }]
  })
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function findValue(row: RawRow, keys: string[]): string | null {
  for (const key of keys) {
    const match = Object.keys(row).find((k) => k.toLowerCase() === key)
    if (match && row[match] !== undefined && row[match] !== '') return row[match]
  }
  return null
}

/**
 * Parses Brazilian date formats:
 * - DD/MM/YYYY → YYYY-MM-DD
 * - YYYY-MM-DD → YYYY-MM-DD (passthrough)
 */
function parseBrazilianDate(raw: string): string | null {
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  return null
}

/**
 * Parses Brazilian numeric formats:
 * - "1.234,56" → 1234.56
 * - "-1.234,56" → -1234.56
 * - "1234.56" → 1234.56
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, '')

  // Brazilian format with comma decimal
  if (/^\-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
    const normalized = cleaned.replace(/\./g, '').replace(',', '.')
    const n = parseFloat(normalized)
    return isNaN(n) ? null : n
  }

  const n = parseFloat(cleaned.replace(',', '.'))
  return isNaN(n) ? null : n
}
