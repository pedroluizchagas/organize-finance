import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAIInsights, isPlanError } from '@/lib/planGuard'

/**
 * POST /api/ai/insights
 * Generates a monthly financial insight for the authenticated user.
 * Aggregates transactions for the given month/year and sends to the LLM.
 * Saves to ai_insights and returns the result.
 *
 * Body: { month: number, year: number }
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const guard = await guardAIInsights(auth.userId)
  if (isPlanError(guard)) return guard

  const body = await req.json().catch(() => ({}))
  const { month, year } = body as { month?: number; year?: number }

  if (!month || !year || month < 1 || month > 12) {
    return NextResponse.json(
      { data: null, error: 'Campos "month" (1-12) e "year" são obrigatórios' },
      { status: 400 }
    )
  }

  // Check if insight already exists — regenerate if requested
  const force = body.force === true

  if (!force) {
    const { data: existing } = await supabaseAdmin
      .from('ai_insights')
      .select('*')
      .eq('user_id', auth.userId)
      .eq('month', month)
      .eq('year', year)
      .single()

    if (existing) {
      return NextResponse.json({ data: existing, error: null })
    }
  }

  // Fetch transactions for the period
  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
  const dateTo = new Date(year, month, 1).toISOString().slice(0, 10) // first day of next month

  const { data: transactions, error: txError } = await supabaseAdmin
    .from('transactions')
    .select('date, description, amount, type, category')
    .eq('user_id', auth.userId)
    .gte('date', dateFrom)
    .lt('date', dateTo)
    .order('date', { ascending: true })

  if (txError) {
    return NextResponse.json({ data: null, error: txError.message }, { status: 500 })
  }

  if (!transactions || transactions.length === 0) {
    return NextResponse.json(
      { data: null, error: 'Nenhuma transação encontrada para o período informado' },
      { status: 404 }
    )
  }

  // Aggregate spending by category
  const categoryTotals: Record<string, number> = {}
  let totalDebit = 0
  let totalCredit = 0

  for (const tx of transactions) {
    const cat = tx.category ?? 'Outros'
    if (tx.type === 'debit') {
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + Number(tx.amount)
      totalDebit += Number(tx.amount)
    } else {
      totalCredit += Number(tx.amount)
    }
  }

  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, total]) => ({ category, total: Number(total.toFixed(2)) }))

  const monthName = new Date(year, month - 1).toLocaleString('pt-BR', { month: 'long' })

  // Build AI prompt
  const prompt = `Você é um consultor financeiro pessoal. Analise os dados financeiros do mês de ${monthName} de ${year} e forneça:

1. Um resumo em português brasileiro, de forma clara e amigável, sobre os gastos e receitas do mês
2. De 3 a 5 dicas práticas e personalizadas para melhorar as finanças
3. Observações sobre os maiores gastos

Dados financeiros:
- Total de gastos: R$ ${totalDebit.toFixed(2)}
- Total de receitas: R$ ${totalCredit.toFixed(2)}
- Saldo do mês: R$ ${(totalCredit - totalDebit).toFixed(2)}
- Número de transações: ${transactions.length}

Gastos por categoria:
${topCategories.map((c) => `- ${c.category}: R$ ${c.total.toFixed(2)}`).join('\n')}

Responda APENAS em JSON válido, sem texto adicional, no seguinte formato:
{
  "summary_text": "Resumo detalhado em português...",
  "tips": [
    "Dica prática 1",
    "Dica prática 2",
    "Dica prática 3"
  ]
}`

  const aiResponse = await callAI(prompt)
  const { summary_text, tips } = aiResponse

  // Upsert insight (handle regeneration)
  const { data: insight, error: saveError } = await supabaseAdmin
    .from('ai_insights')
    .upsert(
      {
        user_id: auth.userId,
        month,
        year,
        summary_text,
        tips,
        top_categories: topCategories,
      },
      { onConflict: 'user_id,month,year' }
    )
    .select()
    .single()

  if (saveError) {
    return NextResponse.json({ data: null, error: saveError.message }, { status: 500 })
  }

  return NextResponse.json({ data: insight, error: null }, { status: 201 })
}

// ---------------------------------------------------------------------------
// AI helper
// ---------------------------------------------------------------------------

async function callAI(prompt: string): Promise<{ summary_text: string; tips: string[] }> {
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

  if (!response.ok) {
    throw new Error(`AI service error: ${response.status}`)
  }

  const data = await response.json()
  const raw: string =
    data?.message?.content ??
    data?.choices?.[0]?.message?.content ??
    data?.response ??
    '{}'

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      summary_text: 'Não foi possível gerar o resumo automático para este mês.',
      tips: [],
    }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      summary_text: typeof parsed.summary_text === 'string' ? parsed.summary_text : '',
      tips: Array.isArray(parsed.tips) ? parsed.tips : [],
    }
  } catch {
    return {
      summary_text: 'Não foi possível gerar o resumo automático para este mês.',
      tips: [],
    }
  }
}
