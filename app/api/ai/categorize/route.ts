import { NextRequest, NextResponse } from 'next/server'

export interface CategorizationInput {
  description: string
}

export interface CategorizationResult {
  description: string
  category: string
  confidence: number
}

const VALID_CATEGORIES = [
  'Alimentação',
  'Transporte',
  'Saúde',
  'Lazer',
  'Assinaturas',
  'Compras',
  'Educação',
  'Moradia',
  'Transferência',
  'Salário',
  'Investimento',
  'Outros',
]

/**
 * POST /api/ai/categorize
 * Internal route. Sends a batch of transaction descriptions to the self-hosted LLM
 * and returns AI-assigned categories with confidence scores.
 *
 * Body: { transactions: { description: string }[] }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.transactions || !Array.isArray(body.transactions)) {
    return NextResponse.json(
      { data: null, error: 'Campo "transactions" é obrigatório e deve ser um array' },
      { status: 400 }
    )
  }

  const inputs: CategorizationInput[] = body.transactions
  if (inputs.length === 0) {
    return NextResponse.json({ data: [], error: null })
  }

  const results = await categorizeTransactions(inputs)
  return NextResponse.json({ data: results, error: null })
}

// ---------------------------------------------------------------------------
// AI integration
// ---------------------------------------------------------------------------

export async function categorizeTransactions(
  inputs: CategorizationInput[]
): Promise<CategorizationResult[]> {
  const aiBaseUrl = process.env.AI_BASE_URL!
  const aiToken = process.env.AI_API_TOKEN!
  const aiModel = process.env.AI_MODEL!

  const descriptionsJson = JSON.stringify(inputs.map((t) => t.description))

  const prompt = `Você é um assistente especializado em categorizar transações bancárias brasileiras.

Categorize cada transação abaixo em UMA das seguintes categorias:
${VALID_CATEGORIES.join(', ')}

Regras importantes:
- PIX, TED, DOC para pessoas físicas → "Transferência"
- Salário, pagamento de salário → "Salário"
- IFOOD, iFood, Rappi, restaurantes, supermercados, padaria → "Alimentação"
- Uber, 99, combustível, estacionamento, pedágio → "Transporte"
- Farmácia, hospital, plano de saúde, médico → "Saúde"
- Netflix, Spotify, Disney, Amazon Prime, assinaturas → "Assinaturas"
- Boleto de aluguel, condomínio, IPTU, água, luz, gás → "Moradia"
- Escola, faculdade, curso, livro → "Educação"
- IOF, tarifas bancárias → "Outros"
- Tesouro Direto, corretora, CDB, LCI, ações → "Investimento"

Responda APENAS com um array JSON válido, sem texto adicional, no formato:
[
  { "description": "DESCRIÇÃO ORIGINAL", "category": "Categoria", "confidence": 0.95 }
]

Transações a categorizar:
${descriptionsJson}`

  const response = await fetch(aiBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiToken}`,
    },
    body: JSON.stringify({
      model: aiModel,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`AI service error: ${response.status} ${response.statusText}`)
  }

  const aiResponse = await response.json()

  // Handle Ollama-compatible response format
  const rawContent: string =
    aiResponse?.message?.content ??
    aiResponse?.choices?.[0]?.message?.content ??
    aiResponse?.response ??
    ''

  // Extract JSON array from the response (AI may include extra text)
  const jsonMatch = rawContent.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    // Fallback: return all as "Outros" with low confidence
    return inputs.map((t) => ({
      description: t.description,
      category: 'Outros',
      confidence: 0.1,
    }))
  }

  let parsed: CategorizationResult[]
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return inputs.map((t) => ({
      description: t.description,
      category: 'Outros',
      confidence: 0.1,
    }))
  }

  // Validate and sanitize each result
  return parsed.map((item, index) => {
    const fallback = inputs[index]?.description ?? ''
    return {
      description: item.description ?? fallback,
      category: VALID_CATEGORIES.includes(item.category) ? item.category : 'Outros',
      confidence: typeof item.confidence === 'number'
        ? Math.min(1, Math.max(0, item.confidence))
        : 0.5,
    }
  })
}
