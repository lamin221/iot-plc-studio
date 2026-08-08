// Persistance locale (navigateur) : sauvegarde automatique + gestion de plusieurs projets.
// A utiliser uniquement dans votre projet reel (Vite/Vercel), PAS dans un apercu d'artefact
// Claude.ai : localStorage y est bloque et cassera le rendu en direct.
// Toutes les fonctions sont protegees : si le stockage local est indisponible (navigation
// privee, quota depasse, etc.), l'appli continue de fonctionner en memoire uniquement.

const NS = "iotplcstudio";
const INDEX_KEY = `${NS}:index`;
const LAST_KEY = `${NS}:last`;
const projectKey = (id) => `${NS}:project:${id}`;

function safe(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    console.warn("[IoT PLC Studio] stockage local indisponible :", e.message);
    return fallback;
  }
}

export function isStorageAvailable() {
  return safe(() => {
    const k = "__iotplc_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  }, false);
}

export function listProjects() {
  return safe(() => JSON.parse(localStorage.getItem(INDEX_KEY) || "[]"), []);
}
function writeIndex(index) {
  safe(() => localStorage.setItem(INDEX_KEY, JSON.stringify(index)));
}

export function saveProject(project) {
  safe(() => {
    localStorage.setItem(projectKey(project.id), JSON.stringify(project));
    const index = listProjects();
    const meta = { id: project.id, name: project.name, updatedAt: Date.now() };
    const next = [meta, ...index.filter((p) => p.id !== project.id)];
    writeIndex(next);
    localStorage.setItem(LAST_KEY, project.id);
  });
}

export function loadProject(id) {
  return safe(() => {
    const raw = localStorage.getItem(projectKey(id));
    return raw ? JSON.parse(raw) : null;
  }, null);
}

export function deleteProject(id) {
  safe(() => {
    localStorage.removeItem(projectKey(id));
    writeIndex(listProjects().filter((p) => p.id !== id));
  });
}

export function renameProject(id, name) {
  safe(() => {
    const p = loadProject(id);
    if (!p) return;
    p.name = name;
    saveProject(p);
  });
}

export function getLastOpenedId() {
  return safe(() => localStorage.getItem(LAST_KEY), null);
}

export function setLastOpenedId(id) {
  safe(() => localStorage.setItem(LAST_KEY, id));
}
