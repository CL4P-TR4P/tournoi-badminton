# Tournois · Badminton Club de Plabennec

Site de gestion des tournois du club : inscriptions, poules, tableau principal et consolante, saisie des scores, terrains, heure de fin et heures de passage estimées, espace joueur avec QR code.

- **Joueurs / public** : consultent tout en direct, sans compte.
- **Organisateurs** : se connectent avec un compte créé par l'administrateur. Personne d'autre ne peut modifier quoi que ce soit (règles de sécurité appliquées par la base de données, pas seulement par l'interface).

Hébergement : **GitHub Pages** (site statique) + **Supabase** (base de données, connexion, temps réel). Les deux sont gratuits pour un club.

---

## 1. Créer la base Supabase (10 min)

1. Crée un projet sur <https://supabase.com> (région Europe, ex. Paris ou Francfort).
2. **SQL Editor** → *New query* → colle le contenu de [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Authentication → Sign In / Providers** : désactive **« Allow new users to sign up »**.
   Ainsi, personne ne peut se créer de compte depuis l'extérieur.
4. **Authentication → Users → Add user → Create new user** : crée le compte de chaque organisateur (e-mail + mot de passe, coche *Auto Confirm User*).
5. Donne-leur les droits d'organisateur (SQL Editor) :

   ```sql
   insert into public.organisateurs (user_id, email)
   select id, email from auth.users where email = 'prenom.nom@exemple.fr';
   ```

   Pour retirer un organisateur : `delete from public.organisateurs where email = '…';`

## 2. Configurer le site

Dans Supabase : **Project Settings → API** (ou *Data API* / *API Keys*), récupère :
- l'**URL du projet** (`https://xxxx.supabase.co`)
- la clé **anon / publishable** (publique par conception, la sécurité est assurée par les règles RLS)

Remplis `js/config.js` :

```js
window.BCP_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "eyJ…  ou  sb_publishable_…"
};
```

⚠️ Ne mets **jamais** la clé `service_role` / `secret` dans ce fichier.

## 3. Publier sur GitHub Pages

```bash
git init && git add . && git commit -m "Site tournois BC Plabennec"
git branch -M main
git remote add origin https://github.com/<compte>/<depot>.git
git push -u origin main
```

Puis sur GitHub : **Settings → Pages → Source : Deploy from a branch → `main` / `(root)`**.
Le site sera disponible sur `https://<compte>.github.io/<depot>/`.

## 4. Utilisation

| Qui | Adresse |
|---|---|
| Public / joueurs | `https://<compte>.github.io/<depot>/` |
| Connexion organisateur (non affichée sur le site) | `https://<compte>.github.io/<depot>/#/orga` |
| Espace joueur d'un tournoi | bouton « Espace joueur » ou QR code |

**QR codes** : dans un tournoi, bouton **QR codes** (organisateurs). Imprime le grand QR et affiche-le dans la salle : en le scannant, chaque joueur choisit son nom une fois, son téléphone s'en souvient. Option « QR individuel par joueur » pour imprimer une planche (un QR par joueur qui ouvre directement son espace).

**Espace joueur** : prochain match et heure estimée, adversaire (ou « 1er poule C » tant que ce n'est pas joué), classement de sa poule, résultats, et une **alerte « C'est à toi ! Terrain X »** quand son match est lancé (vibration + notification si autorisée, page ouverte). Un joueur inscrit dans plusieurs tableaux voit tout au même endroit : son nom doit être écrit pareil dans chaque tableau.

## Bon à savoir

- **Projet gratuit Supabase en pause** après 7 jours sans activité : ouvre le site (ou le tableau de bord Supabase) quelques jours avant un tournoi pour le réveiller.
- **Plusieurs organisateurs en même temps** : les scores sont enregistrés par mise à jour partielle côté serveur, deux personnes peuvent saisir des matchs différents simultanément.
- Les heures estimées dépendent de la durée moyenne d'un match (réglable, et recalée automatiquement par le bouton « Utiliser X min » après quelques matchs).

## Structure

```
index.html            page unique
css/style.css         thème rouge et noir du club
js/config.js          adresse + clé publique Supabase
js/logic.js           règles du badminton : scores, classements, poules, tableaux, planning
js/app.js             interface, connexion, temps réel, espace joueur, QR
js/vendor/qrcode.js   génération des QR codes (MIT, Kazuhiko Arase)
supabase/schema.sql   tables, sécurité (RLS), fonctions, temps réel
```
