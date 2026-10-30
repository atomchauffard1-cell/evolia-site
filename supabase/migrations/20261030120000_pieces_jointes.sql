-- Pièce jointe facultative du formulaire de contact (cahier des charges, brief).
-- Le fichier est stocké dans un espace privé ; la table garde son chemin, son nom, son type et sa taille.
alter table public.messages_contact add column piece_jointe jsonb;

-- Espace de stockage privé : 5 Mo maximum, PDF et Word uniquement.
-- Aucune règle d'accès : seul le serveur (clé secrète) lit, et le visiteur dépose son fichier
-- par un lien d'envoi à usage unique fourni par la fonction « contact ».
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pieces-jointes', 'pieces-jointes', false, 5242880, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
