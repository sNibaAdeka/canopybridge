-- IRON ECHO rating tables. Apply once (Supabase SQL editor, or the migration tool). The API server uses the service key, which bypasses
-- row level security; RLS is on with no policies so that nothing else (the public anon key) can read or write these tables.
create table if not exists public.ie_players (
  id          uuid primary key,
  nick        text not null check (char_length(nick) between 3 and 16),
  nick_key    text not null unique check (char_length(nick_key) >= 3),
  secret_hash text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.ie_ratings (
  player_id  uuid not null references public.ie_players (id) on delete cascade,
  ladder     text not null check (ladder in ('keys', 'camera')),
  rating     numeric(8, 2) not null default 1000,
  games      integer not null default 0,
  wins       integer not null default 0,
  losses     integer not null default 0,
  draws      integer not null default 0,
  kos        integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, ladder)
);
create index if not exists ie_ratings_board on public.ie_ratings (ladder, rating desc, games) where games > 0;

create table if not exists public.ie_bouts (
  id          bigint generated always as identity primary key,
  player_id   uuid not null references public.ie_players (id) on delete cascade,
  ladder      text not null check (ladder in ('keys', 'camera')),
  level       smallint not null check (level between 0 and 2),
  result      text not null check (result in ('win', 'loss', 'draw')),
  method      text not null,
  seed        integer not null,
  frames      integer not null,
  replay_hash text not null,
  created_at  timestamptz not null default now(),
  unique (player_id, replay_hash)
);
create index if not exists ie_bouts_player_time on public.ie_bouts (player_id, created_at desc);

alter table public.ie_players enable row level security;
alter table public.ie_ratings enable row level security;
alter table public.ie_bouts enable row level security;
