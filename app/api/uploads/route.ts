import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { guardUploadLimit, isPlanError } from '@/lib/planGuard'

const ALLOWED_FORMATS = ['ofx', 'csv', 'pdf'] as const
type FileFormat = (typeof ALLOWED_FORMATS)[number]
const MAX_FILE_SIZE_MB = 10

/**
 * POST /api/uploads
 * Receives a statement file (multipart/form-data), uploads to Supabase Storage,
 * creates a statement_uploads record, and enqueues for processing.
 *
 * Form fields:
 * - file: File (required)
 * - account_id: string (required)
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const guard = await guardUploadLimit(auth.userId)
  if (isPlanError(guard)) return guard

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ data: null, error: 'Requisição inválida: esperado multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const accountId = formData.get('account_id') as string | null

  if (!file) {
    return NextResponse.json({ data: null, error: 'Campo "file" é obrigatório' }, { status: 400 })
  }
  if (!accountId) {
    return NextResponse.json({ data: null, error: 'Campo "account_id" é obrigatório' }, { status: 400 })
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return NextResponse.json(
      { data: null, error: `Arquivo muito grande. Máximo: ${MAX_FILE_SIZE_MB}MB` },
      { status: 400 }
    )
  }

  // Detect format from extension
  const fileName = file.name.toLowerCase()
  const ext = fileName.split('.').pop() as string
  const format = ALLOWED_FORMATS.includes(ext as FileFormat) ? (ext as FileFormat) : null

  if (!format) {
    return NextResponse.json(
      { data: null, error: 'Formato não suportado. Use OFX, CSV ou PDF.' },
      { status: 400 }
    )
  }

  // Verify account ownership
  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('id')
    .eq('id', accountId)
    .eq('user_id', auth.userId)
    .single()

  if (accountError || !account) {
    return NextResponse.json({ data: null, error: 'Conta não encontrada' }, { status: 404 })
  }

  // Upload file to Supabase Storage
  const fileBuffer = Buffer.from(await file.arrayBuffer())
  const storagePath = `${auth.userId}/${accountId}/${Date.now()}_${file.name}`

  const { error: storageError } = await supabaseAdmin.storage
    .from('statements')
    .upload(storagePath, fileBuffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (storageError) {
    return NextResponse.json({ data: null, error: `Erro ao salvar arquivo: ${storageError.message}` }, { status: 500 })
  }

  const { data: urlData } = supabaseAdmin.storage
    .from('statements')
    .getPublicUrl(storagePath)

  // Create statement_uploads record
  const { data: upload, error: uploadError } = await supabaseAdmin
    .from('statement_uploads')
    .insert({
      user_id: auth.userId,
      account_id: accountId,
      file_url: urlData.publicUrl,
      file_name: file.name,
      format,
      status: 'pending',
    })
    .select()
    .single()

  if (uploadError) {
    return NextResponse.json({ data: null, error: uploadError.message }, { status: 500 })
  }

  // Enqueue for processing
  const { error: queueError } = await supabaseAdmin
    .from('processing_queue')
    .insert({
      upload_id: upload.id,
      user_id: auth.userId,
      status: 'pending',
    })

  if (queueError) {
    // Non-fatal: the record exists, worker can pick it up via a fallback scan
    console.error('Failed to enqueue upload:', queueError.message)
  }

  return NextResponse.json({ data: upload, error: null }, { status: 201 })
}

/**
 * GET /api/uploads
 * Lists uploads for the authenticated user with their status.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account_id')

  let query = supabaseAdmin
    .from('statement_uploads')
    .select('*')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })

  if (accountId) {
    query = query.eq('account_id', accountId)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, error: null })
}
