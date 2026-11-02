-- SoFy online accounts: profiles, roles, access keys and guarded RPCs.
-- Passwords and email confirmation are handled by Supabase Auth; the app
-- authenticates with a synthetic address derived from the username.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  avatar text,
  role text not null default 'user' check (role in ('user', 'admin', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$'),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 40)
);

create unique index if not exists profiles_single_owner
  on public.profiles (role) where role = 'owner';

create table if not exists public.access_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  role text not null check (role in ('user', 'admin')),
  note text,
  hint text not null,
  created_by uuid references public.profiles (id) on delete set null,
  redeemed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  revoked_at timestamptz
);

create index if not exists access_keys_created_by_idx on public.access_keys (created_by);
create index if not exists access_keys_redeemed_by_idx on public.access_keys (redeemed_by);

alter table public.profiles enable row level security;
alter table public.access_keys enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.access_keys from anon, authenticated;

create or replace function public.profile_json(
  p_id uuid,
  p_username text,
  p_display_name text,
  p_avatar text,
  p_role text,
  p_created_at timestamptz,
  p_updated_at timestamptz
) returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_id,
    'username', p_username,
    'displayName', p_display_name,
    'avatar', p_avatar,
    'role', p_role,
    'createdAt', (extract(epoch from p_created_at) * 1000)::bigint,
    'updatedAt', (extract(epoch from p_updated_at) * 1000)::bigint
  );
$$;

-- Creates the profile together with the auth user. Access keys are redeemed
-- atomically here, so a failed key cannot leave a half-registered account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_display text;
  v_key text;
  v_compact text;
  v_role text := 'user';
  v_key_row public.access_keys%rowtype;
  v_owner_exists boolean;
begin
  v_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  if v_username !~ '^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$' then
    raise exception 'invalid_username';
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    raise exception 'username_taken';
  end if;

  v_display := trim(regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    '[[:cntrl:]]', '', 'g'));
  v_display := left(v_display, 40);
  if v_display = '' then
    v_display := v_username;
  end if;

  v_key := nullif(trim(coalesce(new.raw_user_meta_data ->> 'access_key', '')), '');
  if v_key is not null then
    v_compact := upper(regexp_replace(v_key, '[^A-Za-z0-9]', '', 'g'));
    if length(v_compact) = 20 and left(v_compact, 4) = 'SOFY' then
      select * into v_key_row
        from public.access_keys
       where key_hash = encode(extensions.digest(v_compact, 'sha256'), 'hex')
         and redeemed_by is null
         and revoked_at is null
       for update;
    end if;
    if v_key_row.id is null then
      raise exception 'access_key_invalid';
    end if;
    v_role := v_key_row.role;
  end if;

  perform pg_advisory_xact_lock(hashtext('sofy-owner-bootstrap'));
  select exists (select 1 from public.profiles where role = 'owner') into v_owner_exists;
  if v_username = 'whyldfx1k' and not v_owner_exists then
    v_role := 'owner';
  end if;

  insert into public.profiles (id, username, display_name, avatar, role)
  values (new.id, v_username, v_display, null, v_role);

  if v_key_row.id is not null then
    update public.access_keys
       set redeemed_by = new.id, redeemed_at = now()
     where id = v_key_row.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.profile_json(p.id, p.username, p.display_name, p.avatar, p.role,
                              p.created_at, p.updated_at)
    from public.profiles p
   where p.id = auth.uid();
$$;

create or replace function public.username_taken(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where username = lower(trim(coalesce(p_username, '')))
  );
$$;

create or replace function public.access_key_status(p_key text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_compact text;
  v_row public.access_keys%rowtype;
begin
  v_compact := upper(regexp_replace(coalesce(p_key, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_compact) <> 20 or left(v_compact, 4) <> 'SOFY' then
    return 'invalid';
  end if;
  select * into v_row
    from public.access_keys
   where key_hash = encode(extensions.digest(v_compact, 'sha256'), 'hex');
  if not found then
    return 'invalid';
  end if;
  if v_row.revoked_at is not null then
    return 'revoked';
  end if;
  if v_row.redeemed_by is not null then
    return 'used';
  end if;
  return 'valid';
end;
$$;

create or replace function public.update_profile(
  p_display_name text,
  p_set_display_name boolean,
  p_avatar text,
  p_set_avatar boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_name text;
  v_avatar text;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found then
    raise exception 'unauthorized';
  end if;

  v_name := v_actor.display_name;
  v_avatar := v_actor.avatar;

  if p_set_display_name then
    v_name := left(trim(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', '', 'g')), 40);
    if v_name = '' then
      raise exception 'invalid_display_name';
    end if;
  end if;

  if p_set_avatar then
    if p_avatar is null then
      v_avatar := null;
    else
      if length(p_avatar) > 760000
         or p_avatar !~* '^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$' then
        raise exception 'invalid_avatar';
      end if;
      v_avatar := p_avatar;
    end if;
  end if;

  update public.profiles
     set display_name = v_name,
         avatar = v_avatar,
         updated_at = now()
   where id = v_actor.id;

  return public.profile_json(v_actor.id, v_actor.username, v_name, v_avatar, v_actor.role,
                             v_actor.created_at, now());
end;
$$;

create or replace function public.create_access_key(p_role text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_role text := lower(trim(coalesce(p_role, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(16);
  v_compact text := '';
  v_key text;
  v_id uuid := gen_random_uuid();
  v_hint text;
  i integer;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or v_actor.role not in ('admin', 'owner') then
    raise exception 'forbidden';
  end if;
  if v_role not in ('user', 'admin') then
    raise exception 'invalid_role';
  end if;
  if v_role = 'admin' and v_actor.role <> 'owner' then
    raise exception 'forbidden_admin_key';
  end if;
  if v_note is not null and length(v_note) > 60 then
    raise exception 'note_too_long';
  end if;

  for i in 0..15 loop
    v_compact := v_compact || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  v_key := 'SOFY-' || substr(v_compact, 1, 4) || '-' || substr(v_compact, 5, 4)
           || '-' || substr(v_compact, 9, 4) || '-' || substr(v_compact, 13, 4);
  v_hint := right(v_compact, 4);

  insert into public.access_keys (id, key_hash, role, note, hint, created_by)
  values (v_id, encode(extensions.digest(v_compact, 'sha256'), 'hex'), v_role, v_note, v_hint,
          v_actor.id);

  return jsonb_build_object(
    'key', v_key,
    'accessKey', jsonb_build_object(
      'id', v_id,
      'role', v_role,
      'note', v_note,
      'hint', v_hint,
      'createdBy', v_actor.username,
      'redeemedBy', null,
      'createdAt', (extract(epoch from now()) * 1000)::bigint,
      'redeemedAt', null,
      'revoked', false,
      'revokedAt', null
    )
  );
end;
$$;

create or replace function public.revoke_access_key(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_key public.access_keys%rowtype;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or v_actor.role not in ('admin', 'owner') then
    raise exception 'forbidden';
  end if;

  select * into v_key from public.access_keys where id = p_id for update;
  if not found then
    raise exception 'key_not_found';
  end if;
  if v_key.revoked_at is not null then
    return jsonb_build_object('ok', true);
  end if;

  if v_actor.role <> 'owner' then
    if v_key.created_by is distinct from v_actor.id then
      raise exception 'forbidden';
    end if;
    if v_key.role = 'admin' then
      raise exception 'forbidden';
    end if;
  end if;

  update public.access_keys set revoked_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.redeem_access_key(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_compact text;
  v_key public.access_keys%rowtype;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found then
    raise exception 'unauthorized';
  end if;
  if v_actor.role <> 'user' then
    raise exception 'already_has_role';
  end if;

  v_compact := upper(regexp_replace(coalesce(p_key, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_compact) <> 20 or left(v_compact, 4) <> 'SOFY' then
    raise exception 'access_key_invalid';
  end if;

  select * into v_key
    from public.access_keys
   where key_hash = encode(extensions.digest(v_compact, 'sha256'), 'hex')
   for update;
  if not found then
    raise exception 'access_key_invalid';
  end if;
  if v_key.revoked_at is not null then
    raise exception 'access_key_revoked';
  end if;
  if v_key.redeemed_by is not null then
    raise exception 'access_key_used';
  end if;

  update public.access_keys
     set redeemed_by = v_actor.id, redeemed_at = now()
   where id = v_key.id;

  if v_key.role = 'admin' then
    update public.profiles
       set role = 'admin', updated_at = now()
     where id = v_actor.id;
    select * into v_actor from public.profiles where id = v_actor.id;
  end if;

  return public.profile_json(v_actor.id, v_actor.username, v_actor.display_name, v_actor.avatar,
                             v_actor.role, v_actor.created_at, v_actor.updated_at);
end;
$$;

create or replace function public.set_account_role(p_account_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_role text := lower(trim(coalesce(p_role, '')));
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or v_actor.role <> 'owner' then
    raise exception 'forbidden';
  end if;
  if v_role not in ('user', 'admin') then
    raise exception 'invalid_role';
  end if;
  if p_account_id = v_actor.id then
    raise exception 'self_role';
  end if;

  select * into v_target from public.profiles where id = p_account_id for update;
  if not found then
    raise exception 'account_not_found';
  end if;
  if v_target.role = 'owner' then
    raise exception 'owner_role_immutable';
  end if;

  update public.profiles
     set role = v_role, updated_at = now()
   where id = p_account_id;

  return public.profile_json(v_target.id, v_target.username, v_target.display_name, v_target.avatar,
                             v_role, v_target.created_at, now());
end;
$$;

create or replace function public.admin_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_accounts jsonb;
  v_keys jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not found or v_actor.role not in ('admin', 'owner') then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(public.profile_json(p.id, p.username, p.display_name, p.avatar,
                                                p.role, p.created_at, p.updated_at)
                            order by p.created_at desc), '[]'::jsonb)
    into v_accounts
    from (select * from public.profiles order by created_at desc, id limit 500) p;

  select coalesce(jsonb_agg(jsonb_build_object(
             'id', k.id,
             'role', k.role,
             'note', k.note,
             'hint', k.hint,
             'createdBy', c.username,
             'redeemedBy', r.username,
             'createdAt', (extract(epoch from k.created_at) * 1000)::bigint,
             'redeemedAt', case when k.redeemed_at is null then null
                                else (extract(epoch from k.redeemed_at) * 1000)::bigint end,
             'revoked', k.revoked_at is not null,
             'revokedAt', case when k.revoked_at is null then null
                               else (extract(epoch from k.revoked_at) * 1000)::bigint end
           ) order by k.created_at desc), '[]'::jsonb)
    into v_keys
    from (select * from public.access_keys order by created_at desc limit 300) k
    left join public.profiles c on c.id = k.created_by
    left join public.profiles r on r.id = k.redeemed_by;

  return jsonb_build_object(
    'accounts', v_accounts,
    'keys', v_keys,
    'actor', public.profile_json(v_actor.id, v_actor.username, v_actor.display_name,
                                 v_actor.avatar, v_actor.role, v_actor.created_at,
                                 v_actor.updated_at)
  );
end;
$$;

revoke all on function public.profile_json(uuid, text, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.my_profile() from public, anon;
revoke all on function public.username_taken(text) from public;
revoke all on function public.access_key_status(text) from public;
revoke all on function public.update_profile(text, boolean, text, boolean) from public, anon;
revoke all on function public.create_access_key(text, text) from public, anon;
revoke all on function public.revoke_access_key(uuid) from public, anon;
revoke all on function public.redeem_access_key(text) from public, anon;
revoke all on function public.set_account_role(uuid, text) from public, anon;
revoke all on function public.admin_data() from public, anon;

grant execute on function public.my_profile() to authenticated;
grant execute on function public.username_taken(text) to anon, authenticated;
grant execute on function public.access_key_status(text) to anon, authenticated;
grant execute on function public.update_profile(text, boolean, text, boolean) to authenticated;
grant execute on function public.create_access_key(text, text) to authenticated;
grant execute on function public.revoke_access_key(uuid) to authenticated;
grant execute on function public.redeem_access_key(text) to authenticated;
grant execute on function public.set_account_role(uuid, text) to authenticated;
grant execute on function public.admin_data() to authenticated;
