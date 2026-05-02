export interface ParsedTransaction {
  date: string       // ISO 8601 date YYYY-MM-DD
  description: string
  amount: number     // positive = credit, negative = debit
  type: 'debit' | 'credit'
}

/**
 * Parses an OFX file buffer and returns a normalized list of transactions.
 * OFX files are SGML-like; we use regex extraction for robustness.
 */
export function parseOFX(fileBuffer: Buffer): ParsedTransaction[] {
  const content = fileBuffer.toString('utf-8')
  const transactions: ParsedTransaction[] = []

  // Match each <STMTTRN>...</STMTTRN> block
  const txBlocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? []

  for (const block of txBlocks) {
    const trntype = extractTag(block, 'TRNTYPE') ?? ''
    const dtposted = extractTag(block, 'DTPOSTED') ?? ''
    const trnamt = extractTag(block, 'TRNAMT') ?? '0'
    const memo = extractTag(block, 'MEMO') ?? extractTag(block, 'NAME') ?? ''

    const date = parseOFXDate(dtposted)
    if (!date) continue

    const rawAmount = parseFloat(trnamt.replace(',', '.'))
    if (isNaN(rawAmount)) continue

    const type: 'debit' | 'credit' =
      trntype.toUpperCase() === 'CREDIT' || rawAmount > 0 ? 'credit' : 'debit'

    transactions.push({
      date,
      description: cleanDescription(memo),
      amount: Math.abs(rawAmount),
      type,
    })
  }

  return transactions
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([^<\r\n]+)`, 'i'))
  return match ? match[1].trim() : null
}

/**
 * Converts OFX date formats to ISO 8601:
 * - 20240115 → 2024-01-15
 * - 20240115120000 → 2024-01-15
 * - 20240115120000[-3:BRT] → 2024-01-15
 */
function parseOFXDate(raw: string): string | null {
  const cleaned = raw.replace(/\[.*?\]/, '').trim()
  const match = cleaned.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!match) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

function cleanDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toUpperCase()
}
