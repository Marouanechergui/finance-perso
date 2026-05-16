# 💰 Finance Perso

Application web personnelle pour suivre les finances d'un couple :
- 💸 Charges (dépenses par catégorie)
- 💵 Revenus
- 🏦 Suivi du remboursement d'un crédit
- 📊 Dashboard avec graphiques

**Données stockées dans une Google Sheet partagée** entre les deux conjoints. Pas de backend, pas de base de données, pas d'abonnement.

## Architecture

```
[Navigateur] ──OAuth Google──▶ [Google Identity]
     │
     ├─ HTML/JS statique servi par GitHub Pages
     │
     └──API Sheets v4──▶ [Google Sheet partagée]
```

- **Frontend** : HTML + JavaScript vanilla + Tailwind CSS (CDN) + Chart.js
- **Auth** : Google OAuth2 (Google Identity Services)
- **Données** : Google Sheets API v4
- **Hébergement** : GitHub Pages
- **Coût** : 0 € (tout est dans les quotas gratuits)

## Sécurité

L'accès est protégé par 3 barrières :
1. **OAuth Testing mode** : seuls les emails listés dans Google Cloud peuvent s'authentifier
2. **Allowlist applicative** : `config.js > ALLOWED_EMAILS` filtre côté client
3. **Partage de la Sheet** : seuls les comptes ayant accès à la Sheet peuvent lire les données

Même si quelqu'un trouve l'URL publique, il ne peut accéder à aucune donnée sans être autorisé sur les 3 niveaux.

## Mise en route

👉 Suis [SETUP.md](SETUP.md) pas à pas (≈ 20-30 min la première fois).

## Structure de la Sheet

👉 Voir [MODELE_SHEET.md](MODELE_SHEET.md).

## Fichiers

```
finance-perso/
├── index.html          # Interface utilisateur
├── js/
│   ├── config.js       # À remplir : CLIENT_ID, SHEET_ID, ALLOWED_EMAILS
│   └── app.js          # Logique applicative
├── SETUP.md            # Guide de configuration Google Cloud + déploiement
├── MODELE_SHEET.md     # Structure de la Sheet à créer
└── README.md           # Ce fichier
```

## Fonctionnalités

- ✅ Dashboard : revenus, charges, épargne du mois, répartition par catégorie, reste crédit
- ✅ Sélecteur de mois pour naviguer dans l'historique
- ✅ Ajout/suppression de charges, revenus, remboursements
- ✅ Autocomplétion des catégories et des noms
- ✅ Graphique d'évolution du crédit
- ✅ Responsive (utilisable sur mobile)

## Limites connues

- Pas d'édition de ligne (il faut supprimer puis recréer)
- Pas d'export PDF/Excel (mais tu peux exporter depuis la Google Sheet directement)
- Pas de notifications/rappels
- Crédit unique (pas de support multi-crédits)
