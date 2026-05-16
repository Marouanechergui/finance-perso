# 🛠️ Guide de mise en place — Finance Perso

Suis ces étapes **dans l'ordre**. Compte environ **20-30 minutes** la première fois.

---

## Étape 1 — Créer la Google Sheet

1. Va sur [sheets.google.com](https://sheets.google.com) et crée une **nouvelle feuille de calcul**.
2. Renomme-la `Finance Perso`.
3. Crée **3 onglets** (clic droit sur l'onglet en bas → renommer) avec EXACTEMENT ces noms :
   - `Charges`
   - `Revenus`
   - `Credit` (sans accent !)
4. Dans chaque onglet, copie ces entêtes en **ligne 1** :

   **Onglet `Charges` :**
   | A | B | C | D | E |
   |---|---|---|---|---|
   | Date | Libellé | Catégorie | Montant | Payé par |

   **Onglet `Revenus` :**
   | A | B | C | D |
   |---|---|---|---|
   | Date | Libellé | Montant | Perçu par |

   **Onglet `Credit` :**
   | A | B | C | D |
   |---|---|---|---|
   | Date | Montant remboursé | Montant restant | Commentaire |

5. **Copie le SHEET_ID** depuis l'URL :
   `https://docs.google.com/spreadsheets/d/`**`CET_ID_ICI`**`/edit`

6. **Partage** la Sheet avec l'email Google de ta femme (clic en haut à droite "Partager" → ajoute son email → droits "Éditeur").

---

## Étape 2 — Créer un projet Google Cloud (gratuit)

1. Va sur [console.cloud.google.com](https://console.cloud.google.com).
2. En haut, clique sur le sélecteur de projet → **Nouveau projet**.
3. Nom : `finance-perso`. Crée-le et attends 30s.
4. Sélectionne ce projet (en haut).

### 2.1 — Activer l'API Sheets

1. Menu ☰ → **API et services** → **Bibliothèque**.
2. Cherche `Google Sheets API` → clique → **Activer**.

### 2.2 — Configurer l'écran de consentement OAuth

1. Menu ☰ → **API et services** → **Écran de consentement OAuth**.
2. Type d'utilisateur : **Externe** → Créer.
3. Remplis :
   - Nom de l'app : `Finance Perso`
   - Email d'assistance : ton email
   - Email du développeur : ton email
4. Clique **Enregistrer et continuer** sur les écrans suivants (pas besoin de scopes ni de test users pour l'instant).
5. À la fin, clique **Revenir au tableau de bord**.
6. Dans **Utilisateurs test**, clique **+ Ajouter des utilisateurs** :
   - Ajoute ton email Google
   - Ajoute l'email Google de ta femme
   - Enregistre.

> ⚠️ Reste en mode **Testing** : l'app fonctionnera indéfiniment pour les emails listés, sans validation Google.

### 2.3 — Créer l'OAuth Client ID

1. Menu ☰ → **API et services** → **Identifiants**.
2. Clique **+ Créer des identifiants** → **ID client OAuth**.
3. Type d'application : **Application Web**.
4. Nom : `Finance Perso Web`.
5. **Origines JavaScript autorisées** — ajoute ces deux URL :
   - `http://localhost:8000` (pour tester en local)
   - `https://TON_USERNAME_GITHUB.github.io` (remplace par ton username GitHub)
6. **URI de redirection autorisés** : laisse vide (on n'en a pas besoin).
7. Clique **Créer**.
8. **Copie le Client ID** affiché (format : `1234-abc.apps.googleusercontent.com`).

---

## Étape 3 — Remplir le fichier de configuration

Ouvre `js/config.js` et remplace :

```js
const CONFIG = {
  CLIENT_ID: 'COLLE_TON_CLIENT_ID_ICI.apps.googleusercontent.com',
  SHEET_ID: 'COLLE_TON_SHEET_ID_ICI',
  ALLOWED_EMAILS: [
    'ton.email@gmail.com',
    'email.de.ta.femme@gmail.com'
  ],
  // ... laisse le reste tel quel
};
```

---

## Étape 4 — Tester en local

Tu ne peux pas ouvrir `index.html` directement en double-cliquant (Google bloque les `file://`). Il faut servir les fichiers via un mini serveur.

**Option A — Python (déjà installé sur Mac/Linux, dispo facilement sur Windows) :**

```bash
cd finance-perso
python -m http.server 8000
```

**Option B — Node.js :**

```bash
cd finance-perso
npx serve -p 8000
```

**Option C — VS Code** : installe l'extension "Live Server", clique droit sur `index.html` → "Open with Live Server".

Puis ouvre [http://localhost:8000](http://localhost:8000).

> Lors de la première connexion, Google affichera "**Cette application n'est pas validée**" → c'est normal en mode Testing. Clique sur "**Paramètres avancés**" → "**Accéder à Finance Perso (non sécurisé)**". Ce message disparaîtra pour les utilisateurs listés en test users.

---

## Étape 5 — Déployer sur GitHub Pages

1. Crée un repo GitHub `finance-perso` (public — voir note plus bas).
2. Depuis le dossier `finance-perso/` :
   ```bash
   git init
   git add .
   git commit -m "init finance-perso"
   git branch -M main
   git remote add origin https://github.com/TON_USERNAME/finance-perso.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings** → **Pages** :
   - Source : `Deploy from a branch`
   - Branch : `main` / `/ (root)`
   - Save.
4. Attends ~1 minute. L'URL sera : `https://TON_USERNAME.github.io/finance-perso/`
5. **Retourne sur Google Cloud → Identifiants → ton OAuth Client** et vérifie que cette URL est bien dans "Origines JavaScript autorisées" (sinon ajoute-la).

> ⚠️ Le repo doit être **public** pour utiliser GitHub Pages gratuit. C'est OK : aucun secret n'est dans le code (le Client ID est public par design, et l'allowlist d'emails ne protège pas une attaque ciblée — la vraie sécurité est que la Sheet n'est partagée qu'avec vous deux).

---

## Étape 6 — C'est en ligne 🎉

Envoie le lien à ta femme. Elle :
1. Ouvre le lien dans son navigateur
2. Clique "Se connecter avec Google"
3. Choisit son compte Google (celui que tu as ajouté en test user)
4. Accepte les permissions
5. Voit le dashboard partagé

---

## Dépannage

| Problème | Solution |
|---|---|
| "Cette application n'est pas validée" | Normal en mode Testing. Clique "Paramètres avancés" → "Accéder à...". |
| "Accès refusé" dans l'app | Ton email n'est pas dans `ALLOWED_EMAILS` dans `config.js`. |
| "403 Forbidden" toast | La Sheet n'est pas partagée avec le compte connecté. |
| "404 Not Found" toast | `SHEET_ID` incorrect ou nom d'onglet (`Charges`/`Revenus`/`Credit`) incorrect. |
| "Erreur de connexion: idpiframe..." | L'URL d'où tu accèdes n'est pas dans "Origines JavaScript autorisées". |
| Modifications du code non visibles | Vide le cache navigateur (Ctrl+Shift+R) ou attends ~1 min après push GitHub. |
