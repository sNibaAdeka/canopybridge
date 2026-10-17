-- IRON ECHO anonymous telemetry (1.7). Apply once (Supabase SQL editor or the migration tool). Written only by the events API with the service
-- key; RLS on with no policies, so the public anon key can neither read nor write. No names, no IP addresses: a random id per browser.
create table if not exists public.ie_events (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  anon_id    text not null check (char_length(anon_id) <= 64),
  session_id text not null check (char_length(session_id) <= 64),
  type       text not null check (char_length(type) <= 32),
  props      jsonb not null default '{}'::jsonb,
  version    text not null default '' check (char_length(version) <= 16),
  ua_class   text not null default '' check (char_length(ua_class) <= 24),
  gpu_class  text not null default '' check (char_length(gpu_class) <= 24),
  country    text not null default '' check (char_length(country) <= 2)
);
create index if not exists ie_events_type_time on public.ie_events (type, ts desc);
create index if not exists ie_events_anon_time on public.ie_events (anon_id, ts desc);
alter table public.ie_events enable row level security;
