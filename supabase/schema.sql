-- =====================================================================
--  Tournois · Badminton Club de Plabennec — schéma Supabase
--  À exécuter une fois dans Supabase > SQL Editor.
--  Lecture publique (joueurs), écriture réservée aux organisateurs.
-- =====================================================================

-- Comptes autorisés à gérer les tournois (ajoutés à la main, voir README)
create table if not exists public.organisateurs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

create table if not exists public.tournois (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tableaux (
  id         text primary key,
  tournoi_id text not null references public.tournois(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tableaux_tournoi_idx on public.tableaux(tournoi_id);

-- L'utilisateur connecté est-il organisateur ?
create or replace function public.is_orga()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.organisateurs where user_id = auth.uid());
$$;

-- Fusion profonde de deux objets JSON (les sous-objets sont fusionnés, le reste est remplacé)
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb
language plpgsql immutable
as $$
declare k text; v jsonb; r jsonb;
begin
  if a is null or jsonb_typeof(a) <> 'object' or b is null or jsonb_typeof(b) <> 'object' then
    return b;
  end if;
  r := a;
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(r -> k) = 'object' then
      r := jsonb_set(r, array[k], public.jsonb_deep_merge(r -> k, v));
    else
      r := jsonb_set(r, array[k], v);
    end if;
  end loop;
  return r;
end;
$$;

-- Mises à jour partielles atomiques (saisie d'un score sans écraser le travail d'un autre orga)
create or replace function public.patch_tableau(p_id text, p_patch jsonb)
returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  if not public.is_orga() then raise exception 'interdit'; end if;
  update public.tableaux set data = public.jsonb_deep_merge(data, p_patch), updated_at = now() where id = p_id;
  if not found then raise exception 'tableau introuvable'; end if;
end;
$$;

create or replace function public.patch_tournoi(p_id text, p_patch jsonb)
returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  if not public.is_orga() then raise exception 'interdit'; end if;
  update public.tournois set data = public.jsonb_deep_merge(data, p_patch), updated_at = now() where id = p_id;
  if not found then raise exception 'tournoi introuvable'; end if;
end;
$$;

revoke execute on function public.patch_tableau(text, jsonb) from public, anon;
revoke execute on function public.patch_tournoi(text, jsonb) from public, anon;
grant  execute on function public.patch_tableau(text, jsonb) to authenticated;
grant  execute on function public.patch_tournoi(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
--  Sécurité (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.organisateurs enable row level security;
alter table public.tournois      enable row level security;
alter table public.tableaux      enable row level security;

-- organisateurs : chacun ne voit que sa propre ligne, personne n'écrit depuis le site
drop policy if exists "orga lit sa ligne" on public.organisateurs;
create policy "orga lit sa ligne" on public.organisateurs
  for select to authenticated using (user_id = auth.uid());

-- tournois / tableaux : lecture pour tous, écriture organisateurs
drop policy if exists "lecture publique" on public.tournois;
create policy "lecture publique" on public.tournois for select to anon, authenticated using (true);
drop policy if exists "orga insere" on public.tournois;
create policy "orga insere" on public.tournois for insert to authenticated with check (public.is_orga());
drop policy if exists "orga modifie" on public.tournois;
create policy "orga modifie" on public.tournois for update to authenticated using (public.is_orga()) with check (public.is_orga());
drop policy if exists "orga supprime" on public.tournois;
create policy "orga supprime" on public.tournois for delete to authenticated using (public.is_orga());

drop policy if exists "lecture publique" on public.tableaux;
create policy "lecture publique" on public.tableaux for select to anon, authenticated using (true);
drop policy if exists "orga insere" on public.tableaux;
create policy "orga insere" on public.tableaux for insert to authenticated with check (public.is_orga());
drop policy if exists "orga modifie" on public.tableaux;
create policy "orga modifie" on public.tableaux for update to authenticated using (public.is_orga()) with check (public.is_orga());
drop policy if exists "orga supprime" on public.tableaux;
create policy "orga supprime" on public.tableaux for delete to authenticated using (public.is_orga());

-- ---------------------------------------------------------------------
--  Temps réel (les écrans des joueurs se mettent à jour tout seuls)
-- ---------------------------------------------------------------------
alter table public.tournois replica identity full;
alter table public.tableaux replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.tournois; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tableaux; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------
--  Ajouter un organisateur (après avoir créé son compte dans
--  Authentication > Users > Add user) :
--
--  insert into public.organisateurs (user_id, email)
--  select id, email from auth.users where email = 'prenom.nom@exemple.fr';
-- ---------------------------------------------------------------------
