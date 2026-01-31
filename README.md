# Bien-ici-Deals 🏡💰

**Bien-ici-Deals** est une extension Google Chrome qui permet de **repérer rapidement les annonces immobilières sous le prix du marché** sur le site **Bien’ici**.

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

## ⚙️ Fonctionnement

1. Lecture des annonces visibles sur Bien’ici  
2. Récupération du **prix au m²** affiché  
3. Calcul du **prix de marché** (médiane) :
   - par ville lorsque possible,
   - sinon sur l’ensemble de la page
4. Comparaison de chaque annonce avec le marché
5. Mise en évidence visuelle automatique

Tout le traitement est effectué **localement dans le navigateur**.

---

## ✨ Fonctionnalités

- Analyse automatique des annonces Bien’ici
- Prise en compte de la **ville**
- Mise à jour en temps réel :
  - scroll infini
  - filtres
  - navigation sans rechargement (SPA)
- Code couleur clair et lisible
- Aucune donnée collectée

---

## 🧱 Structure du projet

L’extension fonctionne avec seulement **deux fichiers** :
├── manifest.json
└── content.js

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
- Le fonctionnement dépend de la structure HTML de Bien’ici :
  - des ajustements peuvent être nécessaires si le site évolue

---

## 🔒 Vie privée

- Aucune donnée personnelle collectée
- Aucune requête externe
- Aucune API utilisée
- Traitement **100 % local** dans le navigateur

---

## ❗ Avertissement

Ce projet n’est **pas affilié à Bien’ici**.  
Il s’agit d’un outil d’aide à la lecture des annonces, destiné à un usage personnel.

---

## 📄 Licence

MIT License

