# MTT - Reste à faire

## 1. État Actuel (Terminé ✅)
- [x] **Architecture** : Projet Tauri + React + TypeScript initialisé.
- [x] **Base de données** : SQLite configuré avec persistance (`mtt.sqlite`).
- [x] **Logique Métier (Backend Rust)** :
    - [x] Création de tournoi, Blinds, Structure.
    - [x] Inscription joueurs & Late Reg.
    - [x] Gestion du Timer (Start/Pause/Next).
    - [x] Seating Aléatoire & Balancing.
    - [x] Undo/Redo (via Event Sourcing).
    - [x] Refine Reset Functionality (Full Reset)
- [x] **Interface (Frontend React)** :
    - [x] Routing complet (Setup, Seating, Clock, Display).
    - [x] Mode Démo (sans backend) vs Mode Tauri.
- [x] **Exports**
    - [x] Export CSV (Frontend + Fallback)
    - [x] Export PDF (frontent + Fallback)

## 2. Qualité & Tests (Terminé ✅)
- [x] **Tests Unitaires Rust**
    - [x] Test `test_seating_randomness` (Core Logic)
    - [x] Test `test_balance_logic` (Core Logic)
- [x] **UX & Polish**
    - [x] Design Premium vérifié.
    - [x] Support Multi-Fenêtre vérifié (Architecture).

> Le projet est prêt pour la livraison.
