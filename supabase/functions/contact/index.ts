// Fonction serveur du formulaire de contact EVOLIA (Supabase Edge Function « contact »).
//
//   POST /contact                          reçoit un message du site (public)
//   GET  /contact/messages                 liste des messages          (mot de passe)
//   POST /contact/messages/:id/:action     traite | reanalyser | supprimer (mot de passe)
//
// Secrets à définir dans Supabase : ANTHROPIC_API_KEY, TABLEAU_MOT_DE_PASSE.
// Facultatifs (e-mails, service Resend) : RESEND_API_KEY ; ALERTE_EMAIL (adresse qui reçoit une alerte
// à chaque message) ; EXPEDITEUR (« EVOLIA <contact@domaine> », adresse d'un domaine vérifié chez Resend,
// nécessaire pour l'accusé de réception aux visiteurs) ; SITE_URL (adresse du site, pour le lien du tableau).

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { analyser, cleDisponible, type Formulaire, MODELE } from "./agent.ts";

declare const EdgeRuntime: { waitUntil(tache: Promise<unknown>): void }; // fourni par Supabase

const TABLE = "messages_contact";
const ESPACE = "pieces-jointes"; // espace de stockage privé des pièces jointes
const CONSERVATION_MOIS = 12;
const MAX_ENVOIS_PAR_10_MIN = 5;
const PIECE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const PIECE_MAX_OCTETS = 5 * 1024 * 1024;
const CHAMPS: Record<string, [boolean, number]> = { // nom : [obligatoire, longueur max]
  prenom: [true, 80], nom: [true, 80], email: [true, 200], telephone: [false, 40],
  organisation: [false, 160], profil: [false, 60], objet: [true, 60], message: [true, 5000],
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-evolia-mot-de-passe",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type PieceJointe = { chemin: string; nom: string; type: string; taille: number };

function cleServeur(): string {
  const cles = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (cles) return JSON.parse(cles).default;
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, cleServeur(), { auth: { persistSession: false } });

function json(code: number, objet: unknown): Response {
  return new Response(JSON.stringify(objet), {
    status: code,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function empreinte(texte: string): Promise<string> {
  const octets = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(octets), (o) => o.toString(16).padStart(2, "0")).join("");
}

async function motDePasseOk(req: Request): Promise<boolean> {
  const attendu = Deno.env.get("TABLEAU_MOT_DE_PASSE");
  const donne = req.headers.get("x-evolia-mot-de-passe") || "";
  if (!attendu || !donne) return false;
  const [a, b] = await Promise.all([empreinte(attendu), empreinte(donne)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Nom de fichier sans accents ni caractères spéciaux, pour le chemin de stockage.
function nomDeFichierSur(nom: string): string {
  const sur = nom.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|-+$/g, "");
  return sur.slice(-80) || "piece-jointe";
}

function sansSautDeLigne(texte: unknown): string {
  return String(texte ?? "").replace(/[\r\n]+/g, " ").trim();
}

async function supprimerPieces(pieces: (PieceJointe | null | undefined)[]): Promise<void> {
  const chemins = pieces.filter((p): p is PieceJointe => Boolean(p?.chemin)).map((p) => p.chemin);
  if (chemins.length) await db.storage.from(ESPACE).remove(chemins);
}

// Conservation limitée (RGPD) : on efface les messages de plus de 12 mois, et leurs pièces jointes.
// Appelé à chaque nouveau message et à chaque ouverture du tableau, pour que l'effacement
// ait lieu même pendant les périodes sans nouveau message.
async function purgerAnciens(): Promise<void> {
  const limite = new Date();
  limite.setMonth(limite.getMonth() - CONSERVATION_MOIS);
  const { data } = await db.from(TABLE).select("id, piece_jointe").lt("recu_le", limite.toISOString());
  if (!data?.length) return;
  await supprimerPieces(data.map((m) => m.piece_jointe));
  await db.from(TABLE).delete().in("id", data.map((m) => m.id));
}

// E-mails envoyés par Resend ; sans clé RESEND_API_KEY, rien n'est envoyé.
async function envoyerMail(destinataire: string, sujet: string, texte: string): Promise<void> {
  const cle = Deno.env.get("RESEND_API_KEY");
  if (!cle) return;
  const expediteur = Deno.env.get("EXPEDITEUR") || "EVOLIA <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + cle, "Content-Type": "application/json" },
      body: JSON.stringify({ from: expediteur, to: [destinataire], subject: sujet, text: texte }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error("e-mail refusé par Resend", r.status, await r.text());
  } catch (err) {
    console.error("envoi d'e-mail impossible", err);
  }
}

const VERDICTS: Record<string, string> = { bon: "Bon", a_verifier: "À vérifier", mauvais: "Mauvais" };

// Alerte à l'équipe, envoyée une fois l'analyse terminée pour inclure le verdict de l'agent.
async function alerterEquipe(m: Record<string, unknown>, analyse: Record<string, unknown>): Promise<void> {
  const destinataire = Deno.env.get("ALERTE_EMAIL");
  if (!destinataire || m.piege) return;
  const verdict = VERDICTS[String(analyse.verdict)] ?? String(analyse.verdict);
  const piece = m.piece_jointe as PieceJointe | null;
  const sujet = sansSautDeLigne(`[EVOLIA] ${verdict} – ${m.prenom} ${m.nom} – ${m.objet}`).slice(0, 180);
  const texte = [
    `Verdict de l'agent : ${verdict} (${analyse.score}/100)`,
    `Résumé : ${analyse.resume}`,
    `Action conseillée : ${analyse.action_conseillee}`,
    "",
    `De : ${m.prenom} ${m.nom}${m.organisation ? " – " + m.organisation : ""} <${m.email}>`,
    m.telephone ? `Téléphone : ${m.telephone}` : "",
    `Objet : ${m.objet}`,
    piece ? `Pièce jointe : ${piece.nom} (à télécharger depuis le tableau)` : "",
    "",
    "Message :",
    String(m.message),
    "",
    "Tous les messages : " + (Deno.env.get("SITE_URL") || "le site d'EVOLIA") + "/tableau-de-bord",
  ].filter((ligne, i, tout) => ligne !== "" || tout[i - 1] !== "").join("\n");
  await envoyerMail(destinataire, sujet, texte);
}

// Accusé de réception au visiteur. Volontairement générique : il ne reprend aucun texte saisi,
// pour que le formulaire ne puisse pas servir à envoyer des messages à n'importe qui.
const ACCUSES = {
  fr: {
    sujet: "Nous avons bien reçu votre message – EVOLIA",
    texte: "Bonjour,\n\nNous avons bien reçu votre message envoyé depuis le site d’EVOLIA. Un membre de l’équipe vous répond sous 48 h ouvrées.\n\nSi vous n’êtes pas à l’origine de ce message, ignorez simplement cet e-mail.\n\nL’équipe EVOLIA\nAssociation de conseil étudiante – ISC Paris, campus d’Orléans",
  },
  en: {
    sujet: "We have received your message – EVOLIA",
    texte: "Hello,\n\nWe have received the message you sent from the EVOLIA website. A member of the team will reply within 2 working days.\n\nIf you did not send this message, simply ignore this email.\n\nThe EVOLIA team\nStudent consulting association – ISC Paris, Orléans campus",
  },
};

async function analyserEtEnregistrer(id: string, alerter = true): Promise<void> {
  try {
    const { data: m, error } = await db.from(TABLE).select("*").eq("id", id).single();
    if (error || !m) throw error ?? new Error("message introuvable");
    const analyse = await analyser(m as Formulaire);
    await db.from(TABLE).update({ tri: analyse, statut: "analyse" }).eq("id", id);
    if (alerter) await alerterEquipe(m, analyse);
  } catch (err) {
    console.error("analyse impossible", id, err);
  }
}

async function recevoir(req: Request): Promise<Response> {
  let entree: Record<string, unknown>;
  try {
    const texte = await req.text();
    if (texte.length > 50_000) return json(413, { erreur: "Message trop long." });
    entree = JSON.parse(texte || "{}");
  } catch {
    return json(400, { erreur: "Requête illisible." });
  }

  const ligne: Record<string, unknown> = {};
  const manquants: string[] = [];
  for (const [champ, [obligatoire, maxi]] of Object.entries(CHAMPS)) {
    const valeur = String(entree[champ] ?? "").trim().slice(0, maxi);
    if (obligatoire && !valeur) manquants.push(champ);
    ligne[champ] = valeur;
  }
  if (entree.consentement !== true) manquants.push("consentement");
  if (manquants.length) return json(422, { erreur: "Champs manquants : " + manquants.join(", ") });
  ligne.langue = entree.langue === "en" ? "en" : "fr";
  ligne.piege = Boolean(String(entree.site ?? "").trim()); // champ invisible anti-robot

  // Pièce jointe annoncée (le fichier lui-même est envoyé ensuite, directement dans le stockage)
  let piece: PieceJointe | null = null;
  const id = crypto.randomUUID();
  if (entree.piece && typeof entree.piece === "object") {
    const p = entree.piece as Record<string, unknown>;
    const nom = String(p.nom ?? "").trim().slice(0, 200);
    const type = String(p.type ?? "");
    const taille = Number(p.taille);
    if (!nom || !PIECE_TYPES.includes(type) || !Number.isFinite(taille) || taille <= 0 || taille > PIECE_MAX_OCTETS) {
      return json(422, { erreur: "Pièce jointe refusée : PDF ou Word, 5 Mo maximum." });
    }
    if (!ligne.piege) piece = { chemin: id + "/" + nomDeFichierSur(nom), nom, type, taille };
  }

  // Limite d'envois par visiteur. L'adresse IP n'est jamais stockée, seulement une empreinte du jour.
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const jour = new Date().toISOString().slice(0, 10);
  ligne.ip_hash = ip ? await empreinte(ip + "|" + jour + "|" + Deno.env.get("SUPABASE_URL")) : null;
  if (ligne.ip_hash) {
    const depuis = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await db.from(TABLE).select("id", { count: "exact", head: true })
      .eq("ip_hash", ligne.ip_hash).gte("recu_le", depuis);
    if ((count ?? 0) >= MAX_ENVOIS_PAR_10_MIN) return json(429, { erreur: "Trop d'envois. Réessayez dans quelques minutes." });
  }

  ligne.id = id;
  ligne.piece_jointe = piece;
  const { error } = await db.from(TABLE).insert(ligne);
  if (error) {
    console.error("enregistrement impossible", error);
    return json(500, { erreur: "Enregistrement impossible." });
  }

  let envoi: { url: string } | null = null;
  if (piece) {
    const { data: lien, error: errLien } = await db.storage.from(ESPACE).createSignedUploadUrl(piece.chemin);
    if (errLien || !lien) console.error("lien d'envoi de la pièce jointe impossible", errLien);
    else envoi = { url: lien.signedUrl };
  }

  EdgeRuntime.waitUntil(analyserEtEnregistrer(id));
  EdgeRuntime.waitUntil(purgerAnciens());
  if (!ligne.piege && Deno.env.get("EXPEDITEUR")) {
    const accuse = ACCUSES[ligne.langue as "fr" | "en"];
    EdgeRuntime.waitUntil(envoyerMail(String(ligne.email), accuse.sujet, accuse.texte));
  }

  return json(200, { ok: true, envoi });
}

async function tableau(req: Request, parties: string[]): Promise<Response> {
  if (!(await motDePasseOk(req))) {
    await new Promise((r) => setTimeout(r, 800)); // ralentit les essais de mot de passe
    return json(401, { erreur: "Mot de passe incorrect." });
  }
  if (req.method === "GET" && parties.length === 1) {
    await purgerAnciens();
    const { data, error } = await db.from(TABLE)
      .select("id, recu_le, prenom, nom, email, telephone, organisation, profil, objet, message, langue, statut, analyse:tri, traite, piece_jointe")
      .order("recu_le", { ascending: false }).limit(500);
    if (error) return json(500, { erreur: "Lecture impossible." });
    // Liens de téléchargement temporaires (1 h) pour les pièces jointes
    const avecPiece = data.filter((m) => m.piece_jointe?.chemin);
    if (avecPiece.length) {
      const { data: liens } = await db.storage.from(ESPACE)
        .createSignedUrls(avecPiece.map((m) => m.piece_jointe.chemin), 3600);
      const parChemin = new Map((liens ?? []).filter((l) => !l.error && l.signedUrl).map((l) => [l.path, l.signedUrl]));
      for (const m of avecPiece) m.piece_jointe.url = parChemin.get(m.piece_jointe.chemin) ?? null;
    }
    return json(200, { messages: data, ia_active: cleDisponible(), modele: MODELE });
  }
  if (req.method === "POST" && parties.length === 3) {
    const [, id, action] = parties;
    if (!/^[0-9a-f-]{36}$/.test(id)) return json(400, { erreur: "Identifiant invalide." });
    if (action === "traite") {
      const { error } = await db.from(TABLE).update({ traite: true }).eq("id", id);
      return json(error ? 500 : 200, { ok: !error });
    }
    if (action === "reanalyser") {
      const { error } = await db.from(TABLE).update({ statut: "en_cours", tri: null }).eq("id", id);
      if (!error) EdgeRuntime.waitUntil(analyserEtEnregistrer(id, false)); // pas de nouvelle alerte
      return json(error ? 500 : 200, { ok: !error });
    }
    if (action === "supprimer") {
      const { data: m } = await db.from(TABLE).select("piece_jointe").eq("id", id).maybeSingle();
      await supprimerPieces([m?.piece_jointe]);
      const { error } = await db.from(TABLE).delete().eq("id", id);
      return json(error ? 500 : 200, { ok: !error });
    }
  }
  return json(404, { erreur: "Action inconnue." });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const chemin = new URL(req.url).pathname.replace(/\/+$/, "");
  const parties = chemin.split("/contact")[1]?.split("/").filter(Boolean) ?? [];
  if (parties.length === 0 && req.method === "POST") return recevoir(req);
  if (parties[0] === "messages") return tableau(req, parties);
  return json(404, { erreur: "Page introuvable." });
});
