-- Pitch402 schema. Run once in the Supabase SQL editor.
--
-- Everything here is reached only by the server, with the service role key.
-- Row Level Security is on for every table and no policy is granted, so the
-- public anon key can read nothing: curator Spotify tokens live in here.

create table if not exists playlists (
  id                     text primary key,
  name                   text not null,
  curator                text not null,
  cycle                  integer not null default 1,
  status                 text not null default 'open',
  spots_per_cycle        integer not null default 100,
  spotify_playlist_id    text,
  spotify_playlist_name  text,
  spotify_playlist_url   text,
  spotify_owner_id       text,
  spotify_followers      integer,
  spotify_base_offset    integer not null default 0,
  spotify_connected_at   timestamptz
);

-- One row per sold spot. This is also the receipt: in Pitch402 a receipt is
-- the sale, so splitting them would only create two things to keep in step.
create table if not exists spots (
  id                 text primary key,
  playlist_id        text not null references playlists(id) on delete cascade,
  cycle              integer not null,
  spot               integer not null,
  amount_atomic      text not null,
  amount             text not null,
  term               text not null,
  track_uri          text not null,
  buyer              text,
  network            text not null,
  payment_method     text not null,
  payment_reference  text,
  settled            boolean not null default false,
  added_at           timestamptz not null default now(),
  placement          jsonb not null,

  -- The most important line in this file. Two agents can pass an
  -- "is it free?" check at the same moment; only one of them can win this
  -- constraint. The loser gets a unique-violation, which the API turns into a
  -- 409 before x402 settles anything, so a spot can never be sold twice.
  constraint spots_one_buyer_per_spot unique (playlist_id, cycle, spot)
);

create index if not exists spots_by_cycle on spots (playlist_id, cycle, spot);

-- Curator Spotify credentials. One connection per Pitch402 playlist.
create table if not exists spotify_connections (
  playlist_id        text primary key references playlists(id) on delete cascade,
  access_token       text not null,
  refresh_token      text not null,
  expires_at         bigint not null,
  scope              text not null,
  spotify_user_id    text not null,
  spotify_user_name  text,
  connected_at       timestamptz not null default now()
);

-- In-flight OAuth handshakes. A callback carrying a state that is not in here
-- is a replay or a stale tab and is refused.
create table if not exists oauth_states (
  state               text primary key,
  playlist_id         text not null,
  attach_playlist_id  text,
  created_at          timestamptz not null default now()
);

-- Which receipt an x402 settlement belongs to. Settlement completes inside the
-- request, but the hook that learns the transaction hash has only the resource
-- URL to go on.
create table if not exists settlements (
  resource    text primary key,
  receipt_id  text not null,
  created_at  timestamptz not null default now()
);

alter table playlists            enable row level security;
alter table spots                enable row level security;
alter table spotify_connections  enable row level security;
alter table oauth_states         enable row level security;
alter table settlements          enable row level security;

-- The demo cycle. Re-runnable: an existing demo playlist is left alone.
insert into playlists (id, name, curator)
values ('demo', 'Pitch402 Demo Cycle', 'demo-curator')
on conflict (id) do nothing;
