# MTT Tournament Director - Guide de Lancement

Ce document explique comment installer et lancer l'application.

## 🚀 Premier Lancement (Installation)

Si vous venez de télécharger le projet, vous devez d'abord installer les dépendances nécessaires.

1.  Ouvrez votre terminal dans le dossier du projet.
2.  Exécutez la commande suivante pour installer les librairies :
    ```bash
    npm install
    ```
3.  Une fois l'installation terminée, vous pouvez lancer l'application avec :
    ```bash
    npm run tauri dev
    ```

Prenez patience lors du premier lancement, la compilation de la partie Rust peut prendre quelques minutes.

---

## ▶️ Chaque Lancement (Utilisation Quotidienne)

Pour utiliser l'application au quotidien, une seule commande suffit.

1.  Ouvrez votre terminal dans le dossier du projet.
2.  Lancez l'application :
    ```bash
    npm run tauri dev
    ```

L'application s'ouvrira dans une nouvelle fenêtre native.

---

## ⚠️ Notes Importantes
- **Mode Web uniquement** : Si vous souhaitez développer l'interface sans les fonctionnalités natives (plus rapide), vous pouvez utiliser `npm run dev`. Cependant, les fonctions liées à la gestion des fichiers ou aux fenêtres ne fonctionneront pas.
