-- Private bucket for bank transfer slips, objects stored as <org_id>/<file>.
-- Only staff and managers of that organization may upload and read. There is no update or delete
-- policy, so nobody can overwrite or remove a slip through the Storage API (the server removes
-- orphaned uploads with the secret key). Tenants, other organizations and anon get nothing.
-- The bucket itself limits uploads to 5 MB and JPEG, PNG or PDF.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips', 'payment-slips', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy payment_slips_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] in (select o::text from private.staff_org_ids() as o)
  );

create policy payment_slips_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] in (select o::text from private.staff_org_ids() as o)
  );
