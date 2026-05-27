-- Storage policies for the 'covers' bucket.
-- First create the bucket in the Supabase dashboard:
--   Storage → Create bucket
--     Name: covers
--     Public: NO
--     File size limit: 200 KB
--     Allowed MIME types: image/jpeg, image/png
-- Then run this SQL.

-- Users can read / write / delete only files inside their own folder:
--   covers/{auth.uid()}/{document_id}.jpg

drop policy if exists "covers owner read" on storage.objects;
drop policy if exists "covers owner write" on storage.objects;
drop policy if exists "covers owner delete" on storage.objects;

create policy "covers owner read" on storage.objects
  for select using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "covers owner write" on storage.objects
  for insert with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "covers owner delete" on storage.objects
  for delete using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
