# Site EVOLIA

Site vitrine statique (HTML/CSS) de l'association EVOLIA, ISC Paris, campus d'Orléans.

- `index.html` : page unique, bascule FR / EN, formulaire de contact
- `tableau-de-bord.html` : messages reçus par le formulaire, triés par l'agent IA (protégé par mot de passe)
- `style.css` : styles (couleurs et police de la charte graphique)
- `assets/` : logo (SVG, PNG), photo d'équipe, police Inter
- `plaquette/` : plaquette PDF de présentation
- `supabase/` : serveur du formulaire (non publié sur le site, voir `.vercelignore`)
  - `migrations/` : table `messages_contact`
  - `functions/contact/` : reçoit les messages, les enregistre et les fait trier par Claude (`agent.ts`)
- `vercel.json` : configuration Vercel

Déploiement du site : chaque push sur `main` est mis en ligne par Vercel.

## Formulaire de contact et agent IA

1. Le visiteur remplit le formulaire ; le message part vers la fonction Supabase `contact` (serveurs à Paris).
2. La fonction l'enregistre, puis l'agent vérifie l'adresse e-mail (jetable, faute de frappe, serveur de messagerie) et demande à Claude (`claude-opus-5-5`) un verdict : bon, à vérifier ou mauvais, avec ses raisons et un brouillon de réponse.
3. L'équipe consulte `/tableau-de-bord` avec le mot de passe commun.

Secrets à définir dans Supabase (Edge Functions → Secrets) : `ANTHROPIC_API_KEY`, `TABLEAU_MOT_DE_PASSE`.
Sans clé Anthropic, le tri se fait par règles simples.

Les messages sont effacés automatiquement après 12 mois. Un même visiteur ne peut pas envoyer plus de 5 messages en 10 minutes.
