-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES
-- ============================================================
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  email text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text check (subscription_status in ('active', 'canceled', 'trialing', 'past_due')),
  trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = id);

-- ============================================================
-- ACCOUNTS
-- ============================================================
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  bank_name text,
  color text,
  created_at timestamptz not null default now()
);

alter table accounts enable row level security;

create policy "Users can view own accounts"
  on accounts for select
  using (auth.uid() = user_id);

create policy "Users can insert own accounts"
  on accounts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own accounts"
  on accounts for update
  using (auth.uid() = user_id);

create policy "Users can delete own accounts"
  on accounts for delete
  using (auth.uid() = user_id);

-- ============================================================
-- STATEMENT_UPLOADS
-- ============================================================
create table if not exists statement_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  file_url text,
  file_name text,
  format text not null check (format in ('ofx', 'csv', 'pdf')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  error_message text,
  transaction_count integer,
  created_at timestamptz not null default now()
);

alter table statement_uploads enable row level security;

create policy "Users can view own uploads"
  on statement_uploads for select
  using (auth.uid() = user_id);

create policy "Users can insert own uploads"
  on statement_uploads for insert
  with check (auth.uid() = user_id);

create policy "Users can update own uploads"
  on statement_uploads for update
  using (auth.uid() = user_id);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  description text not null,
  amount numeric(12,2) not null,
  type text not null check (type in ('debit', 'credit')),
  category text,
  ai_confidence numeric(3,2) check (ai_confidence >= 0 and ai_confidence <= 1),
  manually_edited boolean not null default false,
  source_upload_id uuid references statement_uploads(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table transactions enable row level security;

create policy "Users can view own transactions"
  on transactions for select
  using (auth.uid() = user_id);

create policy "Users can insert own transactions"
  on transactions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own transactions"
  on transactions for update
  using (auth.uid() = user_id);

create policy "Users can delete own transactions"
  on transactions for delete
  using (auth.uid() = user_id);

-- Index for common filters
create index if not exists transactions_user_date_idx on transactions (user_id, date);
create index if not exists transactions_account_idx on transactions (account_id);
create index if not exists transactions_category_idx on transactions (user_id, category);

-- ============================================================
-- AI_INSIGHTS
-- ============================================================
create table if not exists ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  month integer not null check (month between 1 and 12),
  year integer not null,
  summary_text text,
  tips jsonb,
  top_categories jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, month, year)
);

alter table ai_insights enable row level security;

create policy "Users can view own insights"
  on ai_insights for select
  using (auth.uid() = user_id);

create policy "Users can insert own insights"
  on ai_insights for insert
  with check (auth.uid() = user_id);

create policy "Users can update own insights"
  on ai_insights for update
  using (auth.uid() = user_id);

-- ============================================================
-- PROCESSING_QUEUE
-- ============================================================
create table if not exists processing_queue (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references statement_uploads(id) on delete cascade,
  user_id uuid not null references profiles(id),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  attempts integer not null default 0,
  last_attempted_at timestamptz,
  created_at timestamptz not null default now()
);

-- processing_queue is managed by the service role only (worker), no RLS needed for users
-- but we still enable RLS and block direct user access
alter table processing_queue enable row level security;

-- No user-facing policies; only service_role can access this table
