# IoT PLC Studio — demo web

Prototype d'atelier logiciel Ladder (IEC 61131-3 simplifie) avec simulation,
mini HMI/SCADA et generation de code Arduino. Tout tourne cote navigateur,
en memoire : aucune donnee n'est envoyee a un serveur, rien n'est persiste
entre deux visites (sauf si vous exportez un projet en JSON).

## Lancer en local

```bash
npm install
npm run dev
```

Puis ouvrez l'URL affichee (en general http://localhost:5173).

## Construire la version de production

```bash
npm run build
```

Le resultat statique est genere dans `dist/`. C'est un site 100% statique
(HTML/JS/CSS) : n'importe quel hebergeur de fichiers statiques convient.

## Deployer — 3 options gratuites

### Option A — Vercel (le plus simple)
1. Poussez ce dossier sur un repo GitHub.
2. Allez sur vercel.com -> "Add New Project" -> importez le repo.
3. Vercel detecte Vite automatiquement (build command `npm run build`,
   dossier de sortie `dist`). Cliquez sur Deploy.
4. Vous obtenez une URL du type `iot-plc-studio.vercel.app`.

### Option B — Netlify
1. Poussez le dossier sur GitHub (ou glissez-deposez le dossier `dist`
   apres un `npm run build` directement sur app.netlify.com/drop).
2. Si vous connectez le repo : build command `npm run build`,
   publish directory `dist`.

### Option C — GitHub Pages
1. `npm run build`
2. Publiez le contenu de `dist/` sur la branche `gh-pages` (par exemple
   avec le paquet `gh-pages` : `npm i -D gh-pages` puis un script
   `"deploy": "gh-pages -d dist"` dans package.json, puis `npm run deploy`).
3. Activez GitHub Pages sur la branche `gh-pages` dans les parametres
   du repo.

## Limites de cette demo (a garder en tete)

- Aucune connexion materielle reelle (pas de televersement Arduino, pas de
  Modbus/MQTT/OPC UA reels) : c'est un simulateur logiciel complet du
  programme Ladder, pas un pilote materiel.
- Aucune persistance serveur : chaque visiteur repart d'un projet vierge.
  Utilisez Exporter/Importer (JSON) pour sauvegarder et recharger un projet.
- Le code Arduino genere est a relire avant tout usage sur un vrai systeme.

## Pour aller plus loin

- Ajouter une sauvegarde automatique dans le navigateur (localStorage /
  IndexedDB) pour que le dernier projet ouvert survive a un rafraichissement
  de page.
- Ajouter une connexion reelle a une carte via le Web Serial API (Chrome/Edge
  uniquement, necessite HTTPS ou localhost).
- Ajouter un backend (Node/Express) pour la compilation reelle (Arduino CLI)
  et les protocoles industriels (Modbus, MQTT, OPC UA).
