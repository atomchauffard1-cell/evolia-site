# Site EVOLIA

Site vitrine statique (HTML/CSS) de l'association EVOLIA, ISC Paris, campus d'Orléans. Bascule FR / EN sur toutes les pages.

- `index.html` : page d'accueil (missions, association, encadrement, équipe)
- `contact.html` : coordonnées et formulaire de contact (servie à l'adresse `/contact`)
- `mentions-legales.html` : mentions légales et données personnelles (`/mentions-legales`)
- `404.html` : page affichée pour une adresse inconnue
- `tableau-de-bord.html` : messages reçus par le formulaire, triés par l'agent IA (protégé par mot de passe)
- `style.css` : styles de toutes les pages (police Lexend, couleurs de la charte, animations)
- `assets/` : logos (dont `logo-evolia-transparent.svg`, sans fond), photos, icônes, polices
- `plaquette/` : plaquette PDF de présentation
- `supabase/` : serveur du formulaire (non publié sur le site, voir `.vercelignore`)
  - `migrations/` : table `messages_contact`
  - `functions/contact/` : reçoit les messages, les enregistre et les fait trier par Claude (`agent.ts`)
- `vercel.json` : adresses sans `.html`, en-têtes de sécurité (CSP, cadres interdits…) et cache des images

Déploiement du site : chaque push sur `main` est mis en ligne par Vercel.

À savoir :
- Les fichiers de `assets/` sont mis en cache un an par les navigateurs : pour remplacer une image, lui donner un nouveau nom.
- Les animations sont désactivées pour les visiteurs qui demandent moins de mouvement dans leur système.
- La politique de sécurité (CSP) n'autorise que le site lui-même et la fonction Supabase : toute nouvelle ressource externe (police, script, carte…) doit y être ajoutée dans `vercel.json`.

## Formulaire de contact et agent IA

1. Le visiteur remplit le formulaire ; le message part vers la fonction Supabase `contact` (serveurs à Paris).
2. La fonction l'enregistre, puis l'agent vérifie l'adresse e-mail (jetable, faute de frappe, serveur de messagerie) et demande à Claude (`claude-opus-5-5`) un verdict : bon, à vérifier ou mauvais, avec ses raisons et un brouillon de réponse.
3. L'équipe consulte `/tableau-de-bord` avec le mot de passe commun.

Secrets à définir dans Supabase (Edge Functions → Secrets) : `ANTHROPIC_API_KEY`, `TABLEAU_MOT_DE_PASSE`.
Sans clé Anthropic, le tri se fait par règles simples.

Les messages de plus de 12 mois sont effacés automatiquement (à chaque nouveau message et à chaque ouverture du tableau). Un même visiteur ne peut pas envoyer plus de 5 messages en 10 minutes.
