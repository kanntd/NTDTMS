-- The shared workspace upsert records the last editor of each party.
alter table public.parties
  add column if not exists updated_by uuid references auth.users(id);

create index if not exists parties_updated_by_idx
  on public.parties(updated_by)
  where updated_by is not null;
