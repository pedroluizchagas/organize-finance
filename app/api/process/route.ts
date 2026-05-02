import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { parseOFX } from '@/lib/parsers/parseOFX'
import { parseCSV } from '@/lib/parsers/parseCSV'
import { parsePDF } from '@/lib/parsers/parsePDF'
import { categorizeTransactions } from '@/app/api/ai/categorize/route'

const BATCH_SIZE = 50

/**
 * POST /api/process
 * Protected by Authorization: Bearer ${WORKER_SECRET}.
 * Called by Vercel Cron every 2 minutes.
 *
 * Picks the oldest pending item from processing_queue, parses the file,
 * categorizes via AI (batched), and saves transactions to DB.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const workerSecret = process.env.WORKER_SECRET

  if (!workerSecret || authHeader !== `Bearer ${workerSecret}`) {
    return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  }

  // Claim the next pending queue item
  const { data: queueItem, error: queueError } = await supabaseAdmin
    .from('processing_queue')
    .select('*, statement_uploads(*)')
    .eq('status', 'pending')
    .lt('attempts', 3) // skip items that already failed 3 times
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (queueError || !queueItem) {
    return NextResponse.json({ data: { message: 'Nenhum item pendente na fila' }, error: null })
  }

  const upload = (queueItem as any).statement_uploads
  if (!upload) {
    return NextResponse.json({ data: null, error: 'Upload não encontrado' }, { status: 404 })
  }

  // Mark as processing
  await supabaseAdmin
    .from('processing_queue')
    .update({
      status: 'processing',
      attempts: (queueItem.attempts ?? 0) + 1,
      last_attempted_at: new Date().toISOString(),
    })
    .eq('id', queueItem.id)

  await supabaseAdmin
    .from('statement_uploads')
    .update({ status: 'processing' })
    .eq('id', upload.id)

  try {
    // Download file from Supabase Storage
    const storagePath = extractStoragePath(upload.file_url)
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('statements')
      .download(storagePath)

    if (downloadError || !fileData) {
      throw new Error(`Erro ao baixar arquivo: ${downloadError?.message}`)
    }

    const fileBuffer = Buffer.from(await fileData.arrayBuffer())

    // Parse based on format
    let rawTransactions: { date: string; description: string; amount: number; type: 'debit' | 'credit' }[]

    if (upload.format === 'ofx') {
      rawTransactions = parseOFX(fileBuffer)
    } else if (upload.format === 'csv') {
      rawTransactions = parseCSV(fileBuffer)
    } else if (upload.format === 'pdf') {
      const { rawLines } = await parsePDF(fileBuffer)
      // For PDF, send lines to AI for extraction + categorization
      rawTransactions = await extractTransactionsFromPDFLines(rawLines, upload.user_id)
    } else {
      throw new Error(`Formato desconhecido: ${upload.format}`)
    }

    if (rawTransactions.length === 0) {
      throw new Error('Nenhuma transação encontrada no arquivo')
    }

    // Categorize in batches of BATCH_SIZE
    const categorized = await categorizeBatched(rawTransactions)

    // Save transactions to DB
    const rows = categorized.map((tx) => ({
      account_id: upload.account_id,
      user_id: upload.user_id,
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      category: tx.category,
      ai_confidence: tx.confidence,
      manually_edited: false,
      source_upload_id: upload.id,
    }))

    const { error: insertError } = await supabaseAdmin.from('transactions').insert(rows)
    if (insertError) throw new Error(`Erro ao salvar transações: ${insertError.message}`)

    // Mark as done
    await supabaseAdmin
      .from('processing_queue')
      .update({ status: 'done' })
      .eq('id', queueItem.id)

    await supabaseAdmin
      .from('statement_uploads')
      .update({ status: 'done', transaction_count: rows.length })
      .eq('id', upload.id)

    return NextResponse.json({
      data: { upload_id: upload.id, transactions_saved: rows.length },
      error: null,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'

    await supabaseAdmin
      .from('processing_queue')
      .update({ status: 'error' })
      .eq('id', queueItem.id)

    await supabaseAdmin
      .from('statement_uploads')
      .update({ status: 'error', error_message: message })
      .eq('id', upload.id)

    return NextResponse.json({ data: null, error: message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function categorizeBatched(
  transactions: { date: string; description: string; amount: number; type: 'debit' | 'credit' }[]
) {
  const results: { date: string; description: string; amount: number; type: 'debit' | 'credit'; category: string; confidence: number }[] = []

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE)
    const categorized = await categorizeTransactions(batch.map((t) => ({ description: t.description })))

    for (let j = 0; j < batch.length; j++) {
      results.push({
        ...batch[j],
        category: categorized[j]?.category ?? 'Outros',
        confidence: categorized[j]?.confidence ?? 0.5,
      })
    }
  }

  return results
}

/**
 * Extracts transactions from PDF raw lines using AI.
 * The AI reads the lines and returns structured transaction data.
 */
async function extractTransactionsFromPDFLines(
  lines: string[],
  userId: string
): Promise<{ date: string; description: string; amount: number; type: 'debit' | 'credit' }[]> {
  const textSample = lines.slice(0, 200).join('\n') // limit context

  const prompt = `Você é um extrator de dados bancários. Leia o texto de extrato bancário abaixo e extraia TODAS as transações.

Texto do extrato:
${textSample}

Responda APENAS com um array JSON válido no formato:
[
  { "date": "YYYY-MM-DD", "description": "DESCRIÇÃO", "amount": 123.45, "type": "debit" }
]

Regras:
- "type" deve ser "debit" para débitos/saídas e "credit" para créditos/entradas
- "amount" deve ser positivo (número absoluto)
- "date" deve ser no formato ISO 8601 YYYY-MM-DD
- Ignore cabeçalhos, totais e rodapés`

  const response = await fetch(process.env.AI_BASE_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AI_API_TOKEN!}`,
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL!,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
  })

  if (!response.ok) return []

  const data = await response.json()
  const raw: string =
    data?.message?.content ?? data?.choices?.[0]?.message?.content ?? data?.response ?? '[]'

  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    return JSON.parse(jsonMatch[0])
  } catch {
    return []
  }
}

function extractStoragePath(fileUrl: string): string {
  // Extract path after /storage/v1/object/public/statements/
  const match = fileUrl.match(/\/statements\/(.+)$/)
  return match ? match[1] : fileUrl
}
