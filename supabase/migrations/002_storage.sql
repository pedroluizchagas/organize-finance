-- Create the statements storage bucket (private)
insert into storage.buckets (id, name, public)
values ('statements', 'statements', false)
on conflict (id) do nothing;

-- Only the authenticated user can upload their own files
create policy "Users can upload own statements"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'statements' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can read only their own files
create policy "Users can read own statements"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'statements' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete only their own files
create policy "Users can delete own statements"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'statements' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
