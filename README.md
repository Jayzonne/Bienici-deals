# Bienici-Deals 🏡💰

**Bienici-Deals** est une extension Google Chrome qui permet de **repérer rapidement les annonces immobilières sous le prix du marché** sur le site **Bien’ici**.

L’extension analyse automatiquement les annonces affichées dans la liste et les compare au **prix réel du marché**, calculé à partir des données visibles (prix au m²).

---

## 🎯 Objectif

Aider à identifier en un coup d’œil :
- les **bonnes affaires** (sous le marché),
- les annonces **au juste prix**,
- les biens **surévalués**.

---

## 🟢🟡🔴 Code couleur

Chaque annonce de la liste est colorée automatiquement :

| Couleur | Signification |
|--------|--------------|
| 🟢 Vert | Sous le prix du marché |
| 🟡 Jaune | Dans le prix du marché |
| 🔴 Rouge | Au-dessus du prix du marché |

---

## ⚙️ Fonctionnement (nouvelle version)

1. Lecture des annonces visibles sur Bien’ici (liste)
2. Récupération du **prix au m²** affiché sur chaque annonce
3. Calcul du **prix de marché** (**médiane**, pas moyenne) :
   - **Marché global de la recherche** : médiane calculée sur les annonces récupérées via l’API Bien’ici (jusqu’à **12 pages**)
   - Le calcul est **mis en cache** tant que l’URL de recherche ne change pas (**en ignorant `page=`**)
   - Si l’API n’est pas disponible, fallback sur la **médiane de la page courante**
4. Comparaison de chaque annonce avec le marché global :
   - **Sous le marché** si en dessous du seuil
   - **Dans le marché** si proche du marché
   - **Au-dessus** si au-dessus du seuil
5. Mise en évidence visuelle automatique (bordures + badge)

Tout le traitement est effectué **localement dans le navigateur**.

---

## ✨ Fonctionnalités

- Analyse automatique des annonces Bien’ici
- Calcul du marché en **médiane**
- **Marché global multi-pages** (jusqu’à **12 pages**) :
  - pagination automatique côté données
  - **déduplication** des annonces quand possible
  - limitation du nombre de pages si la recherche contient moins de résultats
- **Cache intelligent** :
  - tant que l’URL ne change pas (en ignorant `page=`), le marché est réutilisé
- Mise à jour en temps réel :
  - scroll infini
  - filtres
  - navigation sans rechargement (SPA)
- Anti “flash” :
  - mise à jour DOM uniquement si nécessaire
  - observation DOM filtrée pour éviter les boucles
- Code couleur clair et lisible
- Aucune donnée collectée

---

## 🧱 Structure du projet

L’extension fonctionne avec seulement **deux fichiers** :
manifest.json
content.js

---

## 🚀 Installation (mode développeur)

1. Cloner ou télécharger ce dépôt
2. Ouvrir Chrome et aller sur `chrome://extensions`
3. Activer le **Mode développeur**
4. Cliquer sur **Charger l’extension non empaquetée**
5. Sélectionner le dossier du projet
6. Recharger une page de résultats sur Bien’ici

---

## ⚠️ Limitations

- La carte Bien’ici utilise un rendu **canvas (WebGL)** :
  - les prix affichés sur la carte ne peuvent pas être modifiés
- Le fonctionnement dépend de la structure HTML / API de Bien’ici :
  - des ajustements peuvent être nécessaires si le site évolue
- Certaines annonces peuvent ne pas fournir un prix au m² exploitable :
  - elles sont ignorées pour le calcul

---

## 🔒 Vie privée

- Aucune donnée personnelle collectée
- Aucune requête externe (hors requêtes déjà effectuées vers Bien’ici)
- Traitement **100 % local** dans le navigateur

---

## ❗ Avertissement

Ce projet n’est **pas affilié à Bien’ici**.  
Il s’agit d’un outil d’aide à la lecture des annonces, destiné à un usage personnel.

---

## 📄 Licence

MIT License

