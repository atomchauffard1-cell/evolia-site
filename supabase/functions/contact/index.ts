// Fonction serveur du formulaire de contact EVOLIA (Supabase Edge Function « contact »).
//
//   POST /contact                          reçoit un message du site (public)
//   GET  /contact/messages                 liste des messages          (mot de passe)
//   POST /contact/messages/:id/:action     traite | reanalyser | supprimer (mot de passe)
//
// Secrets à définir dans Supabase : ANTHROPIC_API_KEY, TABLEAU_MOT_DE_PASSE.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { analyser, cleDisponible, type Formulaire, MODELE } from "./agent.ts";

const TABLE = "messages_contact";
const CONSERVATION_MOIS = 12;
const MAX_ENVOIS_PAR_10_MIN = 5;
const CHAMPS: Record<string, [boolean, number]> = { // nom : [obligatoire, longueur max]
  prenom: [true, 80], nom: [true, 80], email: [true, 200], telephone: [false, 40],
  organisation: [false, 160], profil: [false, 60], objet: [true, 60], message: [true, 5000],
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-evolia-mot-de-passe",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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

async function analyserEtEnregistrer(id: string): Promise<void> {
  try {
    const { data: m, error } = await db.from(TABLE).select("*").eq("id", id).single();
    if (error || !m) throw error ?? new Error("message introuvable");
    const analyse = await analyser(m as Formulaire);
    await db.from(TABLE).update({ analyse, statut: "analyse" }).eq("id", id);
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

  const { data, error } = await db.from(TABLE).insert(ligne).select("id").single();
  if (error || !data) {
    console.error("enregistrement impossible", error);
    return json(500, { erreur: "Enregistrement impossible." });
  }
  EdgeRuntime.waitUntil(analyserEtEnregistrer(data.id));

  // Conservation limitée (RGPD) : on efface les messages de plus de 12 mois.
  const limite = new Date();
  limite.setMonth(limite.getMonth() - CONSERVATION_MOIS);
  EdgeRuntime.waitUntil(db.from(TABLE).delete().lt("recu_le", limite.toISOString()).then(() => {}));

  return json(200, { ok: true });
}

async function tableau(req: Request, parties: string[]): Promise<Response> {
  if (!(await motDePasseOk(req))) {
    await new Promise((r) => setTimeout(r, 800)); // ralentit les essais de mot de passe
    return json(401, { erreur: "Mot de passe incorrect." });
  }
  if (req.method === "GET" && parties.length === 1) {
    const { data, error } = await db.from(TABLE)
      .select("id, recu_le, prenom, nom, email, telephone, organisation, profil, objet, message, langue, statut, analyse, traite")
      .order("recu_le", { ascending: false }).limit(500);
    if (error) return json(500, { erreur: "Lecture impossible." });
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
      const { error } = await db.from(TABLE).update({ statut: "en_cours", analyse: null }).eq("id", id);
      if (!error) EdgeRuntime.waitUntil(analyserEtEnregistrer(id));
      return json(error ? 500 : 200, { ok: !error });
    }
    if (action === "supprimer") {
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
