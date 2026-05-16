# 📊 Structure de la Google Sheet

Crée une feuille de calcul Google avec **3 onglets** (noms exacts, sensibles à la casse) :

## Onglet 1 — `Charges`

| Date | Libellé | Catégorie | Montant | Payé par | Statut |
|------|---------|-----------|---------|----------|--------|
| 2026-05-01 | Loyer | Logement | 850 | Moi | Fixe |
| 2026-05-02 | Courses Carrefour | Alimentation | 124.50 | Femme | Variable |
| 2026-05-05 | Essence | Transport | 65 | Moi | Variable |
| 2026-05-15 | Netflix | Loisirs | 15.99 | Commun | Fixe |

- **Date** : format `YYYY-MM-DD` (l'app le saisit automatiquement via `<input type="date">`).
- **Catégorie** : libre, l'app mémorise celles déjà saisies pour autocomplétion.
- **Montant** : nombre, point comme séparateur décimal (124.50).
- **Payé par** : libre (Moi / Femme / Commun / un prénom).
- **Statut** : `Fixe` ou `Variable` (vide = traité comme `Variable`).
  - `Fixe` = charge récurrente mensuelle. Apparaît dans tous les mois ≥ sa date.
  - `Variable` = charge ponctuelle. Apparaît seulement dans le mois de sa date.

## Onglet 2 — `Revenus`

| Date | Libellé | Montant | Perçu par | Statut |
|------|---------|---------|-----------|--------|
| 2026-05-01 | Salaire | 2400 | Moi | Fixe |
| 2026-05-01 | Salaire | 2100 | Femme | Fixe |
| 2026-05-20 | Prime exceptionnelle | 500 | Moi | Variable |

- **Statut** : même logique que pour les charges. Salaires habituellement en `Fixe`.

## Onglet 3 — `Credit`

| Date | Montant remboursé | Montant restant | Commentaire |
|------|-------------------|------------------|-------------|
| 2026-01-15 | 0 | 145000 | Solde initial |
| 2026-02-15 | 850 | 144150 | Mensualité |
| 2026-03-15 | 850 | 143300 | Mensualité |

- La **première ligne** sert à initialiser le solde du crédit (mets `0` en remboursé et ton capital restant dû).
- Ensuite, chaque mois tu ajoutes une ligne avec ce que vous avez remboursé et le nouveau reste à devoir.
- L'app affichera la **dernière entrée** comme "Reste actuel" et tracera l'évolution dans le temps.

---

## Conseils de saisie

- ✅ Ne supprime **pas** les entêtes en ligne 1.
- ✅ Tu peux saisir directement dans la Sheet (depuis ton téléphone Google Sheets app) OU via l'interface web — les deux fonctionnent.
- ✅ Le format des montants doit utiliser le **point** (`.`) comme séparateur décimal, pas la virgule.
- ❌ N'ajoute pas de colonnes supplémentaires : l'app lit toujours les mêmes colonnes A-F (Charges), A-E (Revenus), A-D (Crédit).

## Si tu as déjà importé la Sheet sans la colonne Statut

Pas de problème — l'app fonctionne quand même (les entrées sans Statut sont traitées comme `Variable`).
Pour utiliser la fonctionnalité Fixe/Variable :
1. Va dans l'onglet `Charges` → cellule **F1** → tape `Statut`
2. Va dans l'onglet `Revenus` → cellule **E1** → tape `Statut`
3. Optionnel : remplis manuellement le statut des lignes existantes (`Fixe` pour le loyer, etc.)
