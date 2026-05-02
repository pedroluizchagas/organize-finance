import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Browser/anon client — use for user-authenticated requests
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Service role client — bypasses RLS. Use only in server-side worker routes.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          email: string | null
          plan: 'free' | 'pro'
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: 'active' | 'canceled' | 'trialing' | 'past_due' | null
          trial_ends_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      accounts: {
        Row: {
          id: string
          user_id: string
          name: string
          bank_name: string | null
          color: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['accounts']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['accounts']['Insert']>
      }
      transactions: {
        Row: {
          id: string
          account_id: string
          user_id: string
          date: string
          description: string
          amount: number
          type: 'debit' | 'credit'
          category: string | null
          ai_confidence: number | null
          manually_edited: boolean
          source_upload_id: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['transactions']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['transactions']['Insert']>
      }
      statement_uploads: {
        Row: {
          id: string
          user_id: string
          account_id: string
          file_url: string | null
          file_name: string | null
          format: 'ofx' | 'csv' | 'pdf'
          status: 'pending' | 'processing' | 'done' | 'error'
          error_message: string | null
          transaction_count: number | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['statement_uploads']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['statement_uploads']['Insert']>
      }
      ai_insights: {
        Row: {
          id: string
          user_id: string
          month: number
          year: number
          summary_text: string | null
          tips: unknown | null
          top_categories: unknown | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['ai_insights']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['ai_insights']['Insert']>
      }
      processing_queue: {
        Row: {
          id: string
          upload_id: string
          user_id: string
          status: 'pending' | 'processing' | 'done' | 'error'
          attempts: number
          last_attempted_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['processing_queue']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['processing_queue']['Insert']>
      }
    }
  }
}
