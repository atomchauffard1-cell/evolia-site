-- Messages reçus par le formulaire de contact du site EVOLIA, avec le verdict de l'agent IA.
create table public.messages_contact (
  id uuid primary key default gen_random_uuid(),
  recu_le timestamptz not null default now(),
  prenom text not null check (char_length(prenom) between 1 and 80),
  nom text not null check (char_length(nom) between 1 and 80),
  email text not null check (char_length(email) between 3 and 200),
  telephone text not null default '' check (char_length(telephone) <= 40),
  organisation text not null default '' check (char_length(organisation) <= 160),
  profil text not null default '' check (char_length(profil) <= 60),
  objet text not null check (char_length(objet) between 1 and 60),
  message text not null check (char_length(message) between 1 and 5000),
  langue text not null default 'fr' check (langue in ('fr', 'en')),
  piege boolean not null default false,
  ip_hash text,
  statut text not null default 'en_cours' check (statut in ('en_cours', 'analyse')),
  tri jsonb, -- verdict de l'agent IA
  traite boolean not null default false
);

create index messages_contact_recu_le_idx on public.messages_contact (recu_le desc);
create index messages_contact_ip_idx on public.messages_contact (ip_hash, recu_le);

-- Aucun accès depuis le navigateur : seule la fonction serveur « contact » (clé secrète) lit et écrit.
alter table public.messages_contact enable row level security;
revoke all on public.messages_contact from anon, authenticated;
