-- ===== Cancionero en vivo: estructura =====
create extension if not exists pgcrypto;

create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '',
  created_at timestamptz not null default now()
);

create table public.grupos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 80),
  codigo text not null unique,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.miembros (
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  user_id uuid not null references public.perfiles(id) on delete cascade,
  rol text not null default 'musico' check (rol in ('admin','musico')),
  created_at timestamptz not null default now(),
  primary key (grupo_id, user_id)
);
create index miembros_user_idx on public.miembros(user_id);

create table public.canciones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 200),
  texto text not null default '' check (char_length(texto) <= 30000),
  categorias text[] not null default '{}',
  publica boolean not null default false,
  creado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index canciones_grupo_idx on public.canciones(grupo_id);
create index canciones_publica_idx on public.canciones(publica) where publica;

create table public.cancioneros (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 120),
  created_at timestamptz not null default now()
);
create index cancioneros_grupo_idx on public.cancioneros(grupo_id);

create table public.cancionero_items (
  id uuid primary key default gen_random_uuid(),
  cancionero_id uuid not null references public.cancioneros(id) on delete cascade,
  cancion_id uuid not null references public.canciones(id) on delete cascade,
  orden int not null default 0,
  tono int not null default 0 check (tono between -11 and 11)
);
create index items_cancionero_idx on public.cancionero_items(cancionero_id);
create index items_cancion_idx on public.cancionero_items(cancion_id);

create table public.salas (
  codigo text primary key check (codigo ~ '^[0-9]{4}$'),
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  director uuid not null references auth.users(id) on delete cascade,
  estado jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create index salas_grupo_idx on public.salas(grupo_id);
create index salas_director_idx on public.salas(director);

-- ===== Funciones de ayuda (permisos) =====
create or replace function public.es_miembro(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.miembros m where m.grupo_id = g and m.user_id = (select auth.uid()));
$$;
create or replace function public.es_admin(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.miembros m where m.grupo_id = g and m.user_id = (select auth.uid()) and m.rol = 'admin');
$$;
create or replace function public.grupo_de_cancionero(c uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select grupo_id from public.cancioneros where id = c;
$$;

-- Perfil automático al registrarse
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles(id, nombre)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'nombre',''), nullif(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.nuevo_usuario();

create or replace function public.tocar_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger canciones_updated before update on public.canciones for each row execute function public.tocar_updated_at();

-- Crear grupo (quien lo crea queda como director)
create or replace function public.crear_grupo(p_nombre text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid; cod text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  loop
    cod := upper(substr(translate(encode(extensions.gen_random_bytes(6),'base64'),'+/=0O1lI','XYZABCDE'),1,6));
    exit when not exists(select 1 from public.grupos where codigo = cod);
  end loop;
  insert into public.grupos(nombre, codigo, creado_por) values (trim(p_nombre), cod, uid) returning id into gid;
  insert into public.miembros(grupo_id, user_id, rol) values (gid, uid, 'admin');
  return gid;
end $$;

-- Unirse con código (si el grupo no tiene miembros, el primero queda como director)
create or replace function public.unirse_grupo(p_codigo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid; uid uuid := auth.uid(); vacio boolean;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  select id into gid from public.grupos where codigo = upper(trim(p_codigo));
  if gid is null then raise exception 'El grupo no existe'; end if;
  select not exists(select 1 from public.miembros where grupo_id = gid) into vacio;
  insert into public.miembros(grupo_id, user_id, rol) values (gid, uid, case when vacio then 'admin' else 'musico' end)
  on conflict do nothing;
  return gid;
end $$;

revoke execute on function public.crear_grupo(text), public.unirse_grupo(text) from public, anon;
grant execute on function public.crear_grupo(text), public.unirse_grupo(text) to authenticated;
revoke execute on function public.nuevo_usuario() from public, anon, authenticated;

-- ===== Seguridad por filas =====
alter table public.perfiles enable row level security;
alter table public.grupos enable row level security;
alter table public.miembros enable row level security;
alter table public.canciones enable row level security;
alter table public.cancioneros enable row level security;
alter table public.cancionero_items enable row level security;
alter table public.salas enable row level security;

-- perfiles: uno mismo, o compañeros de grupo
create policy perfiles_ver on public.perfiles for select to authenticated using (
  id = (select auth.uid()) or exists(select 1 from public.miembros a join public.miembros b on a.grupo_id = b.grupo_id where a.user_id = (select auth.uid()) and b.user_id = perfiles.id));
create policy perfiles_editar on public.perfiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- grupos
create policy grupos_ver on public.grupos for select to authenticated using (public.es_miembro(id));
create policy grupos_editar on public.grupos for update to authenticated using (public.es_admin(id)) with check (public.es_admin(id));
create policy grupos_borrar on public.grupos for delete to authenticated using (public.es_admin(id));

-- miembros
create policy miembros_ver on public.miembros for select to authenticated using (public.es_miembro(grupo_id));
create policy miembros_rol on public.miembros for update to authenticated using (public.es_admin(grupo_id)) with check (public.es_admin(grupo_id));
create policy miembros_salir on public.miembros for delete to authenticated using (user_id = (select auth.uid()) or public.es_admin(grupo_id));

-- canciones: el grupo ve las suyas; todos ven las públicas; solo directores editan
create policy canciones_ver on public.canciones for select to authenticated using (publica or public.es_miembro(grupo_id));
create policy canciones_crear on public.canciones for insert to authenticated with check (public.es_admin(grupo_id));
create policy canciones_editar on public.canciones for update to authenticated using (public.es_admin(grupo_id)) with check (public.es_admin(grupo_id));
create policy canciones_borrar on public.canciones for delete to authenticated using (public.es_admin(grupo_id));

-- cancioneros
create policy libros_ver on public.cancioneros for select to authenticated using (public.es_miembro(grupo_id));
create policy libros_crear on public.cancioneros for insert to authenticated with check (public.es_admin(grupo_id));
create policy libros_editar on public.cancioneros for update to authenticated using (public.es_admin(grupo_id)) with check (public.es_admin(grupo_id));
create policy libros_borrar on public.cancioneros for delete to authenticated using (public.es_admin(grupo_id));

create policy items_ver on public.cancionero_items for select to authenticated using (public.es_miembro(public.grupo_de_cancionero(cancionero_id)));
create policy items_crear on public.cancionero_items for insert to authenticated with check (
  public.es_admin(public.grupo_de_cancionero(cancionero_id))
  and exists(select 1 from public.canciones c where c.id = cancion_id and c.grupo_id = public.grupo_de_cancionero(cancionero_id)));
create policy items_editar on public.cancionero_items for update to authenticated using (public.es_admin(public.grupo_de_cancionero(cancionero_id))) with check (public.es_admin(public.grupo_de_cancionero(cancionero_id)));
create policy items_borrar on public.cancionero_items for delete to authenticated using (public.es_admin(public.grupo_de_cancionero(cancionero_id)));

-- salas: cualquiera con sesión que tenga el código puede verla; solo el director la maneja
create policy salas_ver on public.salas for select to authenticated using (true);
create policy salas_crear on public.salas for insert to authenticated with check (director = (select auth.uid()) and public.es_admin(grupo_id));
create policy salas_editar on public.salas for update to authenticated using (director = (select auth.uid())) with check (director = (select auth.uid()));
create policy salas_borrar on public.salas for delete to authenticated using (director = (select auth.uid()));

-- ===== Grabaciones y links (covers) =====
create table public.grabaciones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  cancion_id uuid references public.canciones(id) on delete set null,
  titulo text not null default '' check (char_length(titulo) <= 150),
  tipo text not null check (tipo in ('audio','link')),
  path text,
  url text check (url is null or url ~* '^https?://'),
  subido_por uuid default auth.uid() references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((tipo = 'audio' and path is not null) or (tipo = 'link' and url is not null))
);
create index grab_grupo_idx on public.grabaciones(grupo_id);
create index grab_cancion_idx on public.grabaciones(cancion_id);
create index grab_subido_idx on public.grabaciones(subido_por);
alter table public.grabaciones enable row level security;
create policy grab_ver on public.grabaciones for select to authenticated using (public.es_miembro(grupo_id));
create policy grab_crear on public.grabaciones for insert to authenticated with check (public.es_miembro(grupo_id) and subido_por = (select auth.uid()));
create policy grab_borrar on public.grabaciones for delete to authenticated using (subido_por = (select auth.uid()) or public.es_admin(grupo_id));

-- Archivos de audio: privados por grupo (carpeta = id del grupo), máx 25 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('grabaciones','grabaciones', false, 26214400, array['audio/mpeg','audio/mp4','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/webm','audio/ogg','audio/opus','video/mp4','video/webm'])
on conflict (id) do nothing;
create policy grab_archivos_ver on storage.objects for select to authenticated using (bucket_id = 'grabaciones' and public.es_miembro(((storage.foldername(name))[1])::uuid));
create policy grab_archivos_subir on storage.objects for insert to authenticated with check (bucket_id = 'grabaciones' and public.es_miembro(((storage.foldername(name))[1])::uuid));
create policy grab_archivos_borrar on storage.objects for delete to authenticated using (bucket_id = 'grabaciones' and (owner_id = (select auth.uid())::text or public.es_admin(((storage.foldername(name))[1])::uuid)));
