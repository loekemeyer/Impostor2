-- ===================================================================
-- Pádel — partidos por cancha y hora (proyecto Supabase "loekemeyer's web")
-- -------------------------------------------------------------------
-- Esquema propio "paddle" para poder borrarlo entero cuando se entregue
-- al cliente (ver LIMPIEZA al final).
--
-- Un partido = (fecha, cancha 1-4, hora "17:00"). Los puntos se guardan
-- como la lista de eventos "abba…f" (ver padel-reglas.js); el marcador se
-- calcula en el navegador.
--
-- Lectura: pública (nombres y puntos, nada sensible), con RLS.
-- Escritura: sólo con las funciones public.paddle_* (SECURITY DEFINER),
-- que validan todo; nadie escribe directo en la tabla.
-- Las funciones viven en "public" porque es el esquema que expone la API.
-- Cada cambio suma "version" (para ignorar avisos viejos de Realtime) y
-- guarda el id del pedido en "procesados" (para no aplicarlo dos veces).
-- ===================================================================

create schema if not exists paddle;

create table paddle.partidos (
  id             uuid        primary key default gen_random_uuid(),
  fecha          date        not null,
  cancha         smallint    not null check (cancha between 1 and 4),
  hora           text        not null check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  nombre_a       text        not null default '' check (char_length(nombre_a) <= 18),
  nombre_b       text        not null default '' check (char_length(nombre_b) <= 18),
  puntos         text        not null default '' check (puntos ~ '^[ab]*f?$' and char_length(puntos) <= 2000),
  set_descartado integer     not null default 0,
  procesados     text[]      not null default '{}',
  version        integer     not null default 0,
  creado         timestamptz not null default now(),
  actualizado    timestamptz not null default now(),
  unique (fecha, cancha, hora)
);

alter table paddle.partidos enable row level security;
create policy partidos_leer on paddle.partidos for select to anon, authenticated using (true);
grant usage on schema paddle to anon, authenticated;
grant select on paddle.partidos to anon, authenticated;
alter publication supabase_realtime add table paddle.partidos;

-- Abre el partido de esa cancha y hora (o el que ya exista) y actualiza los nombres.
create or replace function public.paddle_abrir(p_fecha date, p_cancha integer, p_hora text, p_nombre_a text, p_nombre_b text)
returns paddle.partidos language plpgsql security definer set search_path = '' as $$
declare r paddle.partidos;
begin
  insert into paddle.partidos as p (fecha, cancha, hora, nombre_a, nombre_b)
  values (p_fecha, p_cancha, p_hora,
          left(btrim(coalesce(p_nombre_a, '')), 18), left(btrim(coalesce(p_nombre_b, '')), 18))
  on conflict (fecha, cancha, hora) do update
     set nombre_a    = case when excluded.nombre_a <> '' then excluded.nombre_a else p.nombre_a end,
         nombre_b    = case when excluded.nombre_b <> '' then excluded.nombre_b else p.nombre_b end,
         version     = p.version + 1,
         actualizado = now()
  returning * into r;
  return r;
end $$;

create or replace function public.paddle_estado(p_id uuid)
returns paddle.partidos language sql stable security definer set search_path = '' as $$
  select * from paddle.partidos where id = p_id
$$;

-- Partidos de un día, para elegir desde el celular que marca.
create or replace function public.paddle_partidos(p_fecha date)
returns setof paddle.partidos language sql stable security definer set search_path = '' as $$
  select * from paddle.partidos where fecha = p_fecha order by cancha, hora
$$;

-- Suma un punto ("a" o "b"). No hace nada si el partido terminó o si ese pedido ya se aplicó.
create or replace function public.paddle_punto(p_id uuid, p_equipo text, p_eid text)
returns paddle.partidos language plpgsql security definer set search_path = '' as $$
declare r paddle.partidos;
begin
  if p_equipo is null or p_equipo not in ('a', 'b') then raise exception 'equipo inválido'; end if;
  if p_eid is null or char_length(p_eid) not between 1 and 40 then raise exception 'pedido inválido'; end if;
  update paddle.partidos
     set puntos      = puntos || p_equipo,
         procesados  = (procesados || p_eid)[greatest(1, cardinality(procesados) - 38):],
         version     = version + 1,
         actualizado = now()
   where id = p_id
     and position('f' in puntos) = 0
     and not (p_eid = any (procesados))
  returning * into r;
  if not found then select * into r from paddle.partidos where id = p_id; end if;
  return r;
end $$;

-- Saca el último evento si es de los permitidos ("a", "b", "ab"; el tablero usa "abf").
create or replace function public.paddle_deshacer(p_id uuid, p_permitidos text, p_eid text)
returns paddle.partidos language plpgsql security definer set search_path = '' as $$
declare r paddle.partidos;
begin
  if p_permitidos is null or p_permitidos !~ '^[abf]{1,3}$' then raise exception 'permitidos inválido'; end if;
  if p_eid is null or char_length(p_eid) not between 1 and 40 then raise exception 'pedido inválido'; end if;
  update paddle.partidos
     set puntos      = left(puntos, -1),
         procesados  = (procesados || p_eid)[greatest(1, cardinality(procesados) - 38):],
         version     = version + 1,
         actualizado = now()
   where id = p_id
     and puntos <> ''
     and strpos(p_permitidos, right(puntos, 1)) > 0
     and not (p_eid = any (procesados))
  returning * into r;
  if not found then select * into r from paddle.partidos where id = p_id; end if;
  return r;
end $$;

-- Fin de set: "Terminar partido".
create or replace function public.paddle_terminar(p_id uuid)
returns paddle.partidos language plpgsql security definer set search_path = '' as $$
declare r paddle.partidos;
begin
  update paddle.partidos
     set puntos = puntos || 'f', version = version + 1, actualizado = now()
   where id = p_id and puntos <> '' and position('f' in puntos) = 0
  returning * into r;
  if not found then select * into r from paddle.partidos where id = p_id; end if;
  return r;
end $$;

-- Fin de set: "Seguir jugando" (cierra el cartel en todos los tableros).
create or replace function public.paddle_seguir(p_id uuid, p_sets integer)
returns paddle.partidos language plpgsql security definer set search_path = '' as $$
declare r paddle.partidos;
begin
  update paddle.partidos
     set set_descartado = greatest(0, least(p_sets, 50)), version = version + 1, actualizado = now()
   where id = p_id
  returning * into r;
  return r;
end $$;

-- "Nuevo partido" en la misma cancha y hora.
create or replace function public.paddle_reiniciar(p_id uuid)
returns paddle.partidos language plpgsql security definer set search_path = '' as $$
declare r paddle.partidos;
begin
  update paddle.partidos
     set puntos = '', set_descartado = 0, procesados = '{}', version = version + 1, actualizado = now()
   where id = p_id
  returning * into r;
  return r;
end $$;

revoke all on function public.paddle_abrir(date, integer, text, text, text),
                       public.paddle_estado(uuid),
                       public.paddle_partidos(date),
                       public.paddle_punto(uuid, text, text),
                       public.paddle_deshacer(uuid, text, text),
                       public.paddle_terminar(uuid),
                       public.paddle_seguir(uuid, integer),
                       public.paddle_reiniciar(uuid) from public;
grant execute on function public.paddle_abrir(date, integer, text, text, text),
                          public.paddle_estado(uuid),
                          public.paddle_partidos(date),
                          public.paddle_punto(uuid, text, text),
                          public.paddle_deshacer(uuid, text, text),
                          public.paddle_terminar(uuid),
                          public.paddle_seguir(uuid, integer),
                          public.paddle_reiniciar(uuid) to anon, authenticated;

-- ===================================================================
-- LIMPIEZA (cuando se entregue al cliente): borra todo lo de arriba.
-- ===================================================================
-- alter publication supabase_realtime drop table paddle.partidos;
-- drop function public.paddle_abrir(date, integer, text, text, text),
--               public.paddle_estado(uuid),
--               public.paddle_partidos(date),
--               public.paddle_punto(uuid, text, text),
--               public.paddle_deshacer(uuid, text, text),
--               public.paddle_terminar(uuid),
--               public.paddle_seguir(uuid, integer),
--               public.paddle_reiniciar(uuid);
-- drop schema paddle cascade;
