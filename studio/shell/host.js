import { withBuildModules } from "./build-modules.mjs";
import { captureBuildSource, assertBuildSourceCurrent, requiresRulePublication } from "./build-source.mjs";
import { applyStoredProjectPatch, assertGenerationActive } from "./generation-patch.mjs";
import { editStoredProject, captureProjectSource } from "./project-edit.mjs";
import { loadProjectScaffold, prepareNewProject, createStoredProject, createStoredChat } from "./project-creation.mjs";
import { storageRequest } from "./storage-request.mjs";
import { executeWorkWithGuest } from "./work-codec.mjs";
import { validateProviderKey } from "./provider-key-validation.mjs";
// The browser host: the surface src/preload.ts exposes as window.electron, implemented on the page
// with no server. Rules come from the generated core (core.wasm: preimage, restore, network, view);
// addresses are BLAKE3 over the bytes the core spells; records live in IndexedDB. Adapters only:
// nothing here decides, it derives, stores and forwards.
//
// Slices 1 and 2: settings, apps and their files, versions as kappa snapshots, chats as records,
// the preview worker, and the app run machine (build in the tab, serve at the version's address).
// The chat stream is the next slice.

import { packBytes, unpackBytes, RepresentationError } from "./exact-representation.mjs";
import { admitWithGuest } from "./composition-codec.mjs";
import { readBoundRules, readBoundRulesSnapshot, saveBoundRules } from "./rules-source.mjs";
import { renameStoredProject, restoreStoredProject, deleteStoredProject, deleteStoredChat, updateStoredChat } from "./project-lifecycle.mjs";
import { invokeHost, unwrapHost } from "./host-boundary.mjs";
import { buildSystemPrompt } from "./prompts.js";
import * as inference from "./inference.js";
import { viewReady, lookup, routeOf, refusalWord, seal as sealAnswer, sealPaid, paidGenerate, gpuReady, gpuIds, heldFor, rulesModel, rememberSession, withEngine, engine, readWho, MODEL_ID, paidId, site, siteKeyReady, deviceKeyGet } from "./inference.js";
import { install, installed, encodeView, b64, unb64, sha256 } from "./holo.js";
import * as prism from "./prism.js";
import * as live from "./live/project.mjs";
import * as lexlean from "./live/lexlean.mjs";
import { frameHtml, FONTS } from "./live/frame-html.mjs";
import { applyOps, createEditor, PatchError } from "./live/edit.mjs";
import { buildOnGitHub } from "./github-build.js";
import * as covers from "./covers.mjs";

const BASE = new URL("./", import.meta.url); // the shell's directory, wherever it is served
const listeners = new Map();
const handlers = new Map();
const seen = new Map();
const emit = (channel, payload) => { const set = listeners.get(channel); if (set) for (const fn of set) { try { fn(payload); } catch (e) { console.error(e); } } };

// ---- the generated core, the addresses and the store come from the shared inference module: one
// core.wasm, one BLAKE3, one database ("hologram-forge" v2) for the builder's records and the seals.
const enc = new TextEncoder(), dec = new TextDecoder();
let core = null;
const coreReady = inference.coreReady().then((c) => (core = c));
const kappa = inference.kappa;
const dbReady = inference.db();
async function tx(store, mode, fn) { return storageRequest(await dbReady, store, mode, fn); }
const get = (store, key) => tx(store, "readonly", (s) => s.get(key));
const put = (store, key, value) => tx(store, "readwrite", (s) => s.put(value, key));
const del = (store, key) => tx(store, "readwrite", (s) => s.delete(key));
const all = (store) => tx(store, "readonly", (s) => s.getAll());
const keys = (store) => tx(store, "readonly", (s) => s.getAllKeys());
// An app's files are the keys "<id>:<path>": read by key range instead of walking every app's keys.
const appRange = (appId) => IDBKeyRange.bound(appId + ":", appId + ":￿");

// ---- settings
const DEFAULT_SETTINGS = {
  // A new visitor starts on GLM 5.3 Flash in the cloud (the site's shared Featherless key answers); BitNet 2B
  // on the device is one click away in the model picker.
  selectedModel: { name: "zai-org/GLM-5.3-Flash", provider: "featherless" }, providerSettings: {}, telemetryConsent: "opted_out", telemetryUserId: "web",
  hasRunBefore: true, experiments: {}, enableProLazyEditsMode: false, enableProSmartFilesContextMode: false, selectedChatMode: "build",
  enableAppBlueprint: false, enableTestingForNewApps: false, enableAutoUpdate: false, releaseChannel: "stable", isRunning: false,
  enableSandboxScriptExecution: false, enableMcpToolSearch: false, enableCodeExplorer: false, runTypeScriptForWholeProject: false,
  enableMultiWindow: false, enableExplorerSubagent: false, enableAutoReview: false, enableReviewButton: false,
  enableImplementerSubagent: false, enableAdvancedSubagents: false, autoFixReviewIssues: false, autoApproveNonSchemaSql: true,
  autoExpandPreviewPanel: true, enableContextCompaction: true, enablePnpmMinimumReleaseAgeWarning: false,
  previewIdleTimeoutPolicy: "default", nodeRuntimePreference: "system", disablePreviewNodeAutoInstall: true,
  // The scaffold every project starts from is a Vite React app, which is the template this names.
  selectedTemplateId: "react",
};
// A stored record from an earlier shell may lack a key a newer renderer reads (providerSettings, say): the
// defaults fill what is missing, the record keeps what it has. One mode is implemented here, the build
// turn that writes files, so that is the mode the record always carries: an agent mode would promise
// tool calls this host does not make.
const BUILD_MODE = { selectedChatMode: "build", defaultChatMode: "build" };
handlers.set("get-user-settings", async () => ({ ...DEFAULT_SETTINGS, ...((await get("settings", "user")) || {}), ...BUILD_MODE }));
handlers.set("set-user-settings", async (patch) => { const s = { ...DEFAULT_SETTINGS, ...((await get("settings", "user")) || {}), ...(patch || {}), ...BUILD_MODE }; await put("settings", "user", s); return s; });
// What the renderer takes as "set up": the site's included key counts as OpenRouter's, the device's
// GPU counts as the local provider's, so no connect dialog stands between the first prompt and the
// answer. The values are words, never the key itself.
handlers.set("get-env-vars", async () => { await siteKeyReady(); const env = {}; if (site.key) env.OPENROUTER_API_KEY = "included by this site"; if (navigator.gpu) env.HOLOGRAM_DEVICE = "webgpu"; return env; });
handlers.set("get-system-platform", () => "web");
handlers.set("get-app-version", () => ({ version: "1.15.0-web" }));
handlers.set("native-theme:get-state", () => ({ shouldUseDarkColors: matchMedia("(prefers-color-scheme: dark)").matches }));
handlers.set("get-initial-load-telemetry-context", () => ({ isFirstSession: false, previousSessionAppSize: null }));
// The build engine is esbuild in the tab; the renderer asks for Node before it shows a preview, so the
// answer names the engine that will run: no Node is installed or needed.
handlers.set("nodejs-status", () => ({ nodeVersion: "browser (esbuild in the tab)", pnpmVersion: "browser", nodeDownloadUrl: "", source: "system", nodePath: null, managedNodeInstalled: false, managedNodeVersion: null, systemNodeTooOld: false, managedNodeSupported: false }));
// A window here is a tab, and its session id has to be a UUID: the renderer parses it, and "web-1"
// was refused, so the window session never initialised and every screen that keys off it -- the
// version controls among them -- reported itself unavailable. The id lasts as long as the tab, which
// is what a window session is, so a reload finds the same one.
const windowSessionId = (() => {
  let id = null;
  try { id = sessionStorage.getItem("holo.window.session"); } catch (e) { id = null; }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "")) {
    id = crypto.randomUUID();
    try { sessionStorage.setItem("holo.window.session", id); } catch (e) {}
  }
  return id;
})();
handlers.set("window-infrastructure:bootstrap", () => ({ windowSessionId, currentQueryInvalidationEpoch: 0, missedInvalidations: [], recoveryScopes: [], mayMigrateLegacyChatTabSession: false, restorableWindowSessionIds: [] }));
for (const c of ["window-infrastructure:set-focused", "window-infrastructure:set-visible-entities", "window-infrastructure:set-chat-tab-ownership", "add-log", "renderer:error-toast-ready", "clear-logs"]) handlers.set(c, () => undefined);
handlers.set("does-release-note-exist", () => ({ exists: false }));
handlers.set("get-user-budget", () => null);
handlers.set("get-subscription-status", () => null);
// Apps live in this browser's store, not in a folder: the path is the store's name and it is not a
// place the visitor can point elsewhere.
handlers.set("get-custom-apps-folder", () => ({ path: inference.DB, isPathAvailable: true, isPathDefault: true }));
handlers.set("get-node-path", () => null);
// What this build is, for the settings page's own debug panel: no Node, no auto updater, the engine
// named where a Node path would be, and the chosen model as the renderer spells it.
handlers.set("get-system-debug-info", async () => {
  const s = (await get("settings", "user")) || DEFAULT_SETTINGS;
  const m = s.selectedModel || {};
  return { nodeVersion: null, pnpmVersion: null, nodePath: "esbuild in the tab", telemetryId: "web", telemetryConsent: "opted_out", telemetryUrl: "", prismVersion: "1.15.0-web", platform: "web", architecture: navigator.userAgent.includes("WOW64") || navigator.userAgent.includes("x86_64") ? "x86_64" : "unknown", logs: "", updaterLogs: null, selectedLanguageModel: (m.provider ? m.provider + "/" : "") + (m.name || "") };
});
const OPENROUTER = { id: "openrouter", name: "OpenRouter", hasFreeTier: true, websiteUrl: "https://openrouter.ai/settings/keys", gatewayPrefix: "openrouter/", type: "cloud" };
const OPENROUTER_MODELS = [
  { apiName: "openrouter/free", displayName: "Free router", description: "Whatever free model OpenRouter routes to", contextWindow: 128000 },
  { apiName: "moonshotai/kimi-k2.5", displayName: "Kimi K2.5", contextWindow: 256000 },
  { apiName: "minimax/minimax-m2.7", displayName: "MiniMax M2.7", contextWindow: 200000 },
  { apiName: "qwen/qwen3.8-flash", displayName: "Qwen 3.8 Flash", contextWindow: 256000 },
  { apiName: "deepseek/deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash", contextWindow: 256000 },
];
// The device is a provider the renderer counts as set up (a custom provider whose "environment variable" is
// the GPU), so a machine with WebGPU needs no key before its first prompt.
const LOCAL = { id: "local", name: "On your device", type: "custom", hasFreeTier: true, envVarName: "HOLOGRAM_DEVICE" };
// The window is the engine's own (q/core/loader.js: BitNet 2B, ctx 3000), not a round number: a build
// turn carries the project's files, so the renderer must know what actually fits.
const LOCAL_MODELS = [{ apiName: MODEL_ID, displayName: "BitNet 2B", description: "Runs on this browser's GPU; every answer is sealed on the device", contextWindow: 3000 }];
// Featherless: open-weight models behind an OpenAI chat endpoint that admits this origin. The key is the
// visitor's, entered on the provider's settings page and kept on this device; the site carries none.
const FEATHERLESS = { id: "featherless", name: "Featherless", hasFreeTier: false, websiteUrl: "https://featherless.ai/account/api-keys", gatewayPrefix: "featherless/", type: "cloud" };
const FEATHERLESS_MODELS = [{ apiName: "zai-org/GLM-5.3-Flash", displayName: "GLM 5.3 Flash", description: "Z.ai's GLM 5.3 Flash on Featherless", contextWindow: 262144 }];
// Two models are offered: GLM 5.3 Flash in the cloud (Featherless) and BitNet 2B on the device. OpenRouter is
// withdrawn from the picker and Settings for now; its models stay defined here, and the warm-up that answers
// while the device model loads is unchanged.
handlers.set("get-language-model-providers", () => [FEATHERLESS, LOCAL]);
handlers.set("get-language-models", ({ providerId }) => (providerId === "openrouter" ? OPENROUTER_MODELS : providerId === "featherless" ? FEATHERLESS_MODELS : providerId === "local" ? LOCAL_MODELS : []));
handlers.set("get-language-models-by-providers", () => ({ featherless: FEATHERLESS_MODELS, local: LOCAL_MODELS }));
handlers.set("validate-provider-api-key", input => validateProviderKey(input));

// ---- apps and files. A file is stored under "<appId>:<path>"; the app record carries no files,
// get-app lists them. Every edit seals a version: the address of the project state.
const nextId = async (store) => { const ks = await keys(store), high = await get("refs", `allocation:${store}`); const maximum = Math.max(0, high || 0, ...ks.map(Number)); if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum >= Number.MAX_SAFE_INTEGER) throw new Error("Identifier allocation failed"); return maximum + 1; };
const nulls = { githubOrg: null, githubRepo: null, githubBranch: null, supabaseProjectId: null, supabaseParentProjectId: null, supabaseOrganizationSlug: null, neonProjectId: null, neonDevelopmentBranchId: null, neonPreviewBranchId: null, neonActiveBranchId: null, selectedDatabaseBranchType: null, vercelProjectId: null, vercelProjectName: null, vercelDeploymentUrl: null, vercelTeamId: null, installCommand: null, startCommand: null, chatContext: null, isFavorite: false, testingEnabled: false, collectionId: null };
const withDates = (a) => ({ ...a, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt), resolvedPath: a.path });
async function filesOf(appId) {
  const ks = (await tx("files", "readonly", (s) => s.getAllKeys(appRange(appId)))).map((k) => k.slice(String(appId).length + 1)).sort();
  return ks;
}
let scaffold = null;
async function loadScaffold() {
  if (!scaffold) scaffold = await loadProjectScaffold(new URL("scaffold/", BASE));
  return scaffold;
}
handlers.set("list-apps", async () => ({ apps: (await all("apps")).map(withDates) }));
handlers.set("get-app", async (id) => { const a = await get("apps", id); if (!a) throw new Error("no app " + id); return { ...withDates(a), files: await filesOf(id), frameworkType: "vite", supabaseProjectName: null, vercelTeamSlug: null }; });
handlers.set("check-app-name", async ({ appName }) => ({ exists: (await all("apps")).some((a) => a.name === appName) }));
handlers.set("preview-app-folder-name", async ({ appName }) => ({ folderName: appName }));
handlers.set("create-app", async ({ name, initialChatMode }) => {
  await coreReady;
  const prepared = await prepareNewProject({ name, initialChatMode, files: await loadScaffold() }, { core, derive: kappa });
  const created = await createStoredProject(await dbReady, prepared, nulls);
  emit("version-created", { appId: created.app.id, oid: created.oid });
  return { app: withDates(created.app), chatId: created.chatId };
});
handlers.set("read-app-file", async ({ appId, filePath }) => { const c = await get("files", appId + ":" + filePath); if (c === undefined) throw new Error("no file " + filePath); return c; });
handlers.set("edit-app-file", async (input) => {
  await coreReady;
  const oid = await editStoredProject(await dbReady, input, { core, derive: kappa });
  emit("version-created", { appId: input.appId, oid });
  return { success: true, warning: null };
});
handlers.set("delete-app", async ({ appId }) => { await deleteStoredProject(await dbReady, appId); liveEditors.delete(appId); await covers.forget(BASE, appId); });
handlers.set("rename-app", async (input) => {
  await coreReady;
  await renameStoredProject(await dbReady, input, { core, derive: kappa, onCommit: oid => emit("version-created", { appId: input.appId, oid }) });
  return { app: withDates(await get("apps", input.appId)) };
});
// A search matches a project by name, by the title of one of its chats, or by a line in one of their
// messages, and says which: the renderer shows the matched title and message under the project's name.
handlers.set("search-app", async (q) => {
  const needle = String(q || "").toLowerCase();
  const chats = await all("chats");
  const out = [];
  for (const a of await all("apps")) {
    const mine = chats.filter((c) => c.appId === a.id);
    const chat = mine.find((c) => String(c.title || "").toLowerCase().includes(needle));
    let message = null;
    for (const c of mine) {
      const hit = (c.messages || []).find((m) => String(m.content || "").toLowerCase().includes(needle));
      if (hit) { message = String(hit.content); break; }
    }
    if (!needle || a.name.toLowerCase().includes(needle) || chat || message) {
      out.push({ ...withDates(a), matchedChatTitle: chat ? String(chat.title || "") : null, matchedChatMessage: message });
    }
  }
  return out;
});
// A file matches by its path or by a line of its text, and the renderer shows the matching line with
// what surrounds it, so the snippets are cut here rather than left out.
handlers.set("search-app-files", async ({ appId, query }) => {
  const needle = String(query || "").toLowerCase();
  const out = [];
  for (const p of await filesOf(appId)) {
    const snippets = [];
    if (needle) {
      const lines = String((await get("files", appId + ":" + p)) || "").split(/\r?\n/);
      for (let i = 0; i < lines.length && snippets.length < 8; i += 1) {
        const at = lines[i].toLowerCase().indexOf(needle);
        if (at < 0) continue;
        snippets.push({ before: lines[i].slice(Math.max(0, at - 40), at), match: lines[i].slice(at, at + needle.length), after: lines[i].slice(at + needle.length, at + needle.length + 40), line: i + 1 });
      }
    }
    if (!needle || p.toLowerCase().includes(needle) || snippets.length) out.push({ path: p, matchesContent: snippets.length > 0, snippets });
  }
  return out;
});
handlers.set("app:get-current-commit-hash", async ({ appId }) => (await get("refs", appId + ":main")) || null);

// ---- moving in. A browser keeps this store per origin, so apps made on the site Forge was served from
// before stay there; its moved page writes them to a file (hologram-forge/export/1) and Import App on the
// home page hands that file here. Ids are renumbered past the ones in use, so nothing here is replaced;
// a name already taken gets " (moved)". The file carries apps, their files, chats, versions, rules state
// and the objects those versions name; cached rule/proof status is ignored and must be rechecked. It never carries settings (keys), the audit, seals, grants or
// installed holos, and anything else in it is ignored. An object is kept only when its bytes derive to
// its address. Everything is written in one transaction: a failure leaves the store as it was.
const EXPORT_SCHEMA = "hologram-forge/export/1";
handlers.set("forge:import", async (input) => {
  const doc = typeof input === "string" ? JSON.parse(input) : input;
  if (!doc || doc.schema !== EXPORT_SCHEMA || !Array.isArray(doc.apps)) throw new Error("This is not a Forge export file (" + EXPORT_SCHEMA + ").");
  const objects = new Map();
  let refused = 0;
  const keep = async (k, bytes) => { if ((await kappa(bytes)) === k) objects.set(k, bytes); else refused += 1; };
  for (const [k, text] of Object.entries(doc.objects || {})) { let bytes = null; try { bytes = unb64(String(text)); } catch (e) { refused += 1; continue; } await keep(k, bytes); }
  const taken = new Set((await all("apps")).map((a) => a.name));
  let appId = await nextId("apps"), chatId = await nextId("chats");
  const writes = [], apps = [];
  for (const entry of doc.apps) {
    const a = entry && entry.app;
    if (!a || typeof a.name !== "string" || !a.name) throw new Error("An app in the file has no name.");
    let name = a.name;
    if (taken.has(name)) { name = a.name + " (moved)"; for (let n = 2; taken.has(name); n += 1) name = a.name + " (moved " + n + ")"; }
    taken.add(name);
    const id = appId++, at = new Date().toISOString();
    writes.push(["apps", id, { ...nulls, ...a, id, name, path: name, createdAt: a.createdAt || at, updatedAt: a.updatedAt || at }]);
    const files = Object.entries(entry.files || {}).filter(([, text]) => typeof text === "string");
    for (const [path, text] of files) { writes.push(["files", id + ":" + path, text]); const bytes = enc.encode(text); objects.set(await kappa(bytes), bytes); }
    if (Array.isArray(entry.versions)) writes.push(["versions", id, entry.versions]);
    if (typeof entry.main === "string" && entry.main) writes.push(["refs", id + ":main", entry.main]);
    const chats = [];
    for (const c of Array.isArray(entry.chats) ? entry.chats : []) {
      if (!c || typeof c !== "object") continue;
      const cid = chatId++;
      writes.push(["chats", cid, { ...c, id: cid, appId: id, messages: Array.isArray(c.messages) ? c.messages : [], referencedApps: [] }]);
      chats.push(cid);
    }
    apps.push({ id, name, from: a.name, chats, files: files.length });
  }
  for (const [k, bytes] of objects) writes.push(["objects", k, bytes]);
  const db = await dbReady;
  await new Promise((res, rej) => {
    let t;
    const refuse = () => rej(Object.assign(new Error("Project storage failed"), { code: "projectStorageFailed" }));
    try {
      t = db.transaction(["apps", "chats", "files", "objects", "refs", "versions"], "readwrite");
      t.oncomplete = res; t.onerror = refuse; t.onabort = refuse;
      const marks = new Map();
      const commit = () => {
        if (marks.size !== 2) return;
        try {
          for (const store of ["apps", "chats"]) {
            const high = marks.get(store), assigned = writes.filter(row => row[0] === store).map(row => row[1]);
            if (!Number.isSafeInteger(high) || high < 0 || assigned.some(id => !Number.isSafeInteger(id) || id <= high)) throw Error("stale allocation");
            if (assigned.length) t.objectStore("refs").put(Math.max(high, ...assigned), `allocation:${store}`);
          }
          for (const [store, key, value] of writes) { if (store === "apps" || store === "chats") t.objectStore(store).add(value, key); else t.objectStore(store).put(value, key); }
        } catch { try { t.abort(); } catch {} refuse(); }
      };
      for (const store of ["apps", "chats"]) { const q = t.objectStore("refs").get(`allocation:${store}`); q.onsuccess = () => { marks.set(store, q.result === undefined ? 0 : q.result); commit(); }; }
    } catch { if (t) { try { t.abort(); } catch {} } refuse(); }
  });
  return { apps, objects: objects.size, refused };
});

// ---- versions: a branch is a name pointing at an address; rollback restores the object at an
// address only when its bytes re-derive to it (the core's restore rule).
handlers.set("list-versions", async ({ appId }) => (await get("versions", appId)) || []);
handlers.set("get-current-branch", async () => ({ branch: "main" }));
// What a version changed, computed from the addresses themselves: a version is the preimage of the
// project state (its JSON lists every file as [path, kappa, bytes] with the parent's address), and
// every file's bytes are an object at their own address, so the diff against the parent is a walk of
// two entry lists. Nothing is stored twice for this.
async function snapshotOf(oid) {
  if (!oid) return null;
  const bytes = await get("objects", oid);
  if (!bytes) return null;
  try { const snap = JSON.parse(dec.decode(bytes)); return Array.isArray(snap.entries) ? snap : null; } catch (e) { return null; }
}
const contentAt = async (kappa) => { const b = kappa ? await get("objects", kappa) : null; return b ? dec.decode(b) : ""; };
handlers.set("get-version-changes", async ({ versionId }) => {
  const snap = await snapshotOf(versionId);
  if (!snap) return [];
  const before = new Map((((await snapshotOf(snap.parent)) || {}).entries || []).map(([path, kappa]) => [path, kappa]));
  const now = new Map(snap.entries.map(([path, kappa]) => [path, kappa]));
  const changes = [];
  for (const [path, kappa] of now) {
    const old = before.get(path);
    if (old === kappa) continue;
    changes.push({ path, type: old ? "modified" : "added", oldContent: await contentAt(old), newContent: await contentAt(kappa) });
  }
  for (const [path, kappa] of before) if (!now.has(path)) changes.push({ path, type: "deleted", oldContent: await contentAt(kappa), newContent: "" });
  return changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
});
handlers.set("set-version-favorite", async ({ appId, oid, isFavorite }) => { const v = (await get("versions", appId)) || []; for (const x of v) if (x.oid === oid) x.isFavorite = isFavorite; await put("versions", appId, v); });
handlers.set("set-version-note", async ({ appId, oid, note }) => { const v = (await get("versions", appId)) || []; for (const x of v) if (x.oid === oid) x.note = note; await put("versions", appId, v); });
async function restore(appId, oid, revert = false) {
  await coreReady;
  return restoreStoredProject(await dbReady, appId, oid, {
    core, onCommit: hash => emit("version-created", { appId, oid: hash }),
    readObject: key => get("objects", key),
    derive: kappa,
    admit: async (derived, expected) => {
      const { decision } = core.run({ op: "restore", derived, expected });
      await put("audit", Date.now() + ":" + oid, { ts: Date.now(), operation: "snapshot.restore", resource: oid, outcome: decision });
      return decision === "Accept";
    },
  }, revert);
}
handlers.set("checkout-version", async ({ appId, versionId }) => { await restore(appId, versionId); });
handlers.set("revert-version", async ({ appId, previousVersionId }) => { await restore(appId, previousVersionId, true); return { successMessage: "Reverted" }; });

// ---- chats as records; the stream is the next slice
handlers.set("get-chats", async (appId) => (await all("chats")).filter((c) => appId == null || c.appId === appId).map((c) => chatRow(c)));
handlers.set("get-chat", async (id) => { const c = await get("chats", id); if (!c) throw new Error("no chat " + id); return { ...c, chatMode: c.chatMode || "build", referencedApps: c.referencedApps || [], messages: (c.messages || []).map((x) => ({ ...x, createdAt: x.createdAt || now() })) }; });
const chatRow = (c) => ({ id: c.id, appId: c.appId, title: c.title, createdAt: new Date(c.createdAt || Date.now()), chatMode: c.chatMode || "build", isFavorite: !!c.isFavorite });
handlers.set("get-chat-metadata", async (id) => { const c = await get("chats", id); return c ? chatRow(c) : null; });
handlers.set("create-chat", async (appId) => createStoredChat(await dbReady, appId, now()));
handlers.set("update-chat", async ({ chatId, title }) => { if (title) await updateStoredChat(await dbReady, chatId, { title }); });
handlers.set("delete-chat", async (id) => { await deleteStoredChat(await dbReady, id); });
// The sidebar's search: a chat matches by title or by the text of one of its messages, and the line
// that matched is what the renderer shows under it.
handlers.set("search-chats", async (q) => {
  const needle = String(q || "").toLowerCase();
  const out = [];
  for (const c of await all("chats")) {
    const hit = (c.messages || []).find((m) => String(m.content || "").toLowerCase().includes(needle));
    if (!needle || String(c.title || "").toLowerCase().includes(needle) || hit) {
      out.push({ id: c.id, appId: c.appId, title: c.title, createdAt: new Date(c.createdAt || Date.now()), matchedMessageContent: hit ? String(hit.content) : null });
    }
  }
  return out;
});
// Counted where it matters: the codebase and the prompt are what a build turn actually sends, and the
// window is the chosen model's own, so the renderer's context meter tells the truth.
handlers.set("chat:count-tokens", async ({ chatId, input }) => {
  const chat = chatId != null ? await get("chats", chatId) : null;
  const settings = (await get("settings", "user")) || DEFAULT_SETTINGS;
  const chosen = (chat && chat.modelSelection && chat.modelSelection.provider ? chat.modelSelection : settings.selectedModel) || {};
  const models = chosen.provider === "openrouter" ? OPENROUTER_MODELS : chosen.provider === "featherless" ? FEATHERLESS_MODELS : LOCAL_MODELS;
  const contextWindow = (models.find((m) => m.apiName === chosen.name) || models[0] || { contextWindow: 4096 }).contextWindow;
  const tokens = (text) => Math.ceil(String(text || "").length / 4);
  const codebaseTokens = chat && chat.appId != null ? tokens(await codebaseOf(chat.appId)) : 0;
  const systemPromptTokens = tokens(buildSystemPrompt(chat && chat.appId != null ? await get("files", chat.appId + ":AI_RULES.md") : ""));
  const messageHistoryTokens = ((chat && chat.messages) || []).reduce((n, m) => n + tokens(m.content), 0);
  const inputTokens = tokens(input);
  return { estimatedTotalTokens: codebaseTokens + systemPromptTokens + messageHistoryTokens + inputTokens, actualMaxTokens: null, messageHistoryTokens, codebaseTokens, mentionedAppsTokens: 0, inputTokens, systemPromptTokens, contextWindow };
});

// ---- the app run machine. the renderer talks to app running as a remote machine: it subscribes
// to a key and dispatches intents; the host owns the state and publishes snapshots. Here START builds
// the project in the tab (esbuild-wasm, dependencies through an import map) and serves it through
// the worker under the model's previewPath of the head address; PROXY_READY is the snapshot with
// phase ready and that url. No process is spawned anywhere.
const machines = new Map(); // "app_run:<appId>" -> { revision, state }
const caps = (phase) => ({ canStart: phase === "idle" || phase === "stopped" || phase === "errored", canRestart: phase === "ready", canRebuild: phase === "ready", canStop: phase === "ready" || phase === "starting", canReload: phase === "ready" });
function machineOf(appId) {
  const key = "app_run:" + appId;
  if (!machines.has(key)) machines.set(key, { revision: 0, state: { appId, revision: 0, previewReloadEpoch: 0, phase: "idle", operation: null, startedAt: null, url: null, operationError: null, exit: null, capabilities: caps("idle"), invocationRef: null, lastSettlement: null } });
  return machines.get(key);
}
function publish(appId, patch) {
  const m = machineOf(appId);
  m.revision += 1;
  m.state = { ...m.state, ...patch, revision: m.revision, capabilities: caps(patch.phase || m.state.phase) };
  emit("distributed-machine:snapshot", { protocolVersion: 1, machineId: "app_run", encodedKey: { appId }, actorInstanceId: "web-app_run-" + appId, revision: m.revision, encodedState: m.state });
  if (m.state.phase === "ready" && m.state.url && m.state.url.appUrl) scheduleCover(appId, m.state.url.appUrl);
  return m;
}
// ---- app covers (covers.mjs). Every preview carries the capture responder; when an app's preview is
// ready and its version has no cover yet, the preview is loaded once more, hidden, at cover size, and its
// picture is stored with the version it shows. The card's words are asked of the visitor's own model
// once per app, and stored only when they meet the rules in covers.mjs.
let coverLibraryReady = null;
const coverLibrary = () => (coverLibraryReady ??= fetch(new URL("assets/html-to-image.js", BASE)).then((r) => (r.ok ? r.text() : null)).catch(() => null));
async function withCoverResponder(html) {
  const library = await coverLibrary();
  return library ? covers.withResponder(html, library) : html;
}
const coverTimers = new Map();
let coverQueue = Promise.resolve();
// A turn writes in batches and the preview is announced ready after each; the picture waits for the last.
function scheduleCover(appId, appUrl) {
  // Only a preview this page built carries the responder; a published app's page on GitHub Pages does not.
  if (!String(appUrl).startsWith(BASE.href)) return;
  clearTimeout(coverTimers.get(appId));
  coverTimers.set(appId, setTimeout(() => {
    coverTimers.delete(appId);
    coverQueue = coverQueue.then(() => coverApp(appId, appUrl)).catch((e) => console.warn("cover", appId, e && e.message));
  }, 4000));
}
async function coverApp(appId, appUrl) {
  if (!(await get("apps", appId))) return;
  const version = ((await get("refs", appId + ":main")) || "") + " " + appUrl;
  if ((await covers.coverVersion(BASE, appId)) === version) return;
  const shot = await covers.capture(appUrl);
  if (!shot) return;
  await covers.saveCover(BASE, appId, await covers.encodeCover(shot.png), version);
  if (!(await covers.hasCard(BASE, appId)) && !turnRunning()) await describeApp(appId, shot.text);
}
// One short request through this origin's own endpoint, so it is routed, sealed and paid as any turn is.
async function describeApp(appId, pageText) {
  const app = await get("apps", appId);
  const settings = (await get("settings", "user")) || DEFAULT_SETTINGS;
  const chosen = settings.selectedModel || {};
  const paid = chosen.provider === "featherless" && chosen.name;
  const model = paid ? chosen.provider + "/" + chosen.name.replace(/^(openrouter|featherless)\//, "") : MODEL_ID;
  let issues = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(new URL("v1/chat/completions", BASE), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: covers.cardMessages(app.name, pageText, issues), max_tokens: paid ? 8192 : 256, temperature: "0.3" }) });
    if (!res.ok) return;
    const answer = (await res.json()).choices?.[0]?.message?.content;
    const read = covers.readCard(answer);
    if (read.card) { await covers.saveCard(BASE, appId, read.card); return; }
    issues = read.issues;
  }
}

let esbuildReady = null;
async function esbuild() {
  if (!esbuildReady) esbuildReady = import("https://cdn.jsdelivr.net/npm/esbuild-wasm@0.25.5/esm/browser.min.js").then(async (m) => { await m.initialize({ wasmURL: "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.25.5/esbuild.wasm" }); return m; });
  return esbuildReady;
}
// The grant a preview is served under. The worker asks the kernel's gate (proved by Lean) before it
// serves a preview, and the gate refuses anything that has no record, so every preview gets one:
// it may be served, and it may reach the hosts its build names: esm.sh for packages and the play
// build of Tailwind. An app may carry its own list in app.grants; nothing else is reachable.
const PREVIEW_ENDPOINTS = ["https://esm.sh", "https://cdn.tailwindcss.com"];
const previewId = (pathname) => pathname.split("/").filter(Boolean).pop();
async function grantPreview(id, endpoints) {
  await put("refs", "capabilities:" + id, { serve: true, network: { endpoints: [...endpoints], denied: [] } });
}

async function verifiedBuildSource(appId) {
  return captureBuildSource(await dbReady, appId, {
    readObject: key => get("objects", key), derive: kappa,
    admit: async (derived, expected) => core.run({ op: "restore", derived, expected }).decision === "Accept",
  });
}
async function buildPreview(appId) {
  await coreReady;
  const source = await verifiedBuildSource(appId);
  const { path } = core.run({ op: "preview", kappa: source.reference });
  const appUrl = new URL(path.slice(1), BASE);
  const owner = await get("apps", appId);
  await grantPreview(previewId(appUrl.pathname), Array.isArray(owner && owner.grants) ? owner.grants : PREVIEW_ENDPOINTS);
  const files = new Map(source.files);
  const pkg = await (await fetch(new URL("scaffold/package.json", BASE))).json();
  const pkgs = Object.fromEntries(Object.entries(pkg.dependencies).map(([n, v]) => [n, v.replace(/^[\^~]/, "")]));
  // Packages the model added with <prism-add-dependency>: name or name@version, resolved by esm.sh.
  for (const d of source.dependencies) { const at = d.lastIndexOf("@"); if (at > 0) pkgs[d.slice(0, at)] = d.slice(at + 1); else pkgs[d] = ""; }
  const react = pkgs.react, dom = pkgs["react-dom"];
  const imports = { react: `https://esm.sh/react@${react}`, "react/": `https://esm.sh/react@${react}/`, "react-dom": `https://esm.sh/react-dom@${dom}?external=react`, "react-dom/": `https://esm.sh/react-dom@${dom}&external=react/` };
  for (const [n, v] of Object.entries(pkgs)) { if (n === "react" || n === "react-dom") continue; const at = v ? "@" + v : ""; imports[n] = `https://esm.sh/${n}${at}?external=react,react-dom`; imports[n + "/"] = `https://esm.sh/${n}${at}&external=react,react-dom/`; }
  const tw = await (await fetch(new URL("scaffold/tailwind.config.ts", BASE))).text();
  const m = tw.match(/theme:\s*(\{[\s\S]*\n  \}),\n  plugins/);
  const tailwindConfig = m ? "{darkMode:['class'],theme:" + m[1] + "}" : "{}";
  const exts = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];
  const resolveFile = (p) => { for (const e of exts) if (files.has(p + e)) return p + e; return null; };
  const plugin = { name: "project", setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") { const r = resolveFile(args.path); if (r) return { path: r, namespace: "project" }; }
      if (args.path.startsWith("@/")) { const r = resolveFile("src/" + args.path.slice(2)); if (r) return { path: r, namespace: "project" }; }
      if (/^\.\.?\//.test(args.path) || args.path.startsWith("/")) {
        const base = args.importer ? args.importer.split("/").slice(0, -1).join("/") : "src";
        const norm = new URL(args.path, "file:///" + base + "/").pathname.slice(1);
        const r = resolveFile(norm); if (r) return { path: r, namespace: "project" };
        return { errors: [{ text: "not in project: " + norm }] };
      }
      return { path: args.path, external: true };
    });
    b.onLoad({ filter: /.*/, namespace: "project" }, (args) => {
      const src = files.get(args.path);
      if (args.path.endsWith(".css")) return { contents: src.replace(/@tailwind[^;]*;/g, ""), loader: "css" };
      return { contents: src, loader: args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".ts") ? "ts" : "jsx" };
    });
  } };
  const es = await esbuild();
  const r = await es.build({ entryPoints: ["src/main.tsx"], bundle: true, write: false, format: "esm", target: "es2022", jsx: "automatic", plugins: [plugin], outdir: "out", logLevel: "silent",
    define: { "import.meta.env.DEV": "true", "import.meta.env.MODE": '"development"', "import.meta.env.BASE_URL": JSON.stringify(appUrl.pathname), "process.env.NODE_ENV": '"development"' } });
  const js = r.outputFiles.find((f) => f.path.endsWith(".js")).text;
  const css = (r.outputFiles.find((f) => f.path.endsWith(".css")) || { text: "" }).text;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script type="importmap">${JSON.stringify({ imports })}<\/script>
<script>tailwind = { config: ${tailwindConfig} };<\/script>
<script src="https://cdn.tailwindcss.com"><\/script>
<style>${css}</style></head><body><div id="root"></div>
<script type="module">${js}<\/script></body></html>`;
  const shown = await withCoverResponder(html);
  await assertBuildSourceCurrent(await dbReady, appId, source);
  const cache = await caches.open("previews");
  await cache.put(appUrl.pathname + "index.html", new Response(shown, { headers: { "content-type": "text/html; charset=utf-8" } }));
  return { appUrl: appUrl.href, bytes: js.length };
}
// ---- the live preview. An app with rules is not built: it is projected. One fixed frame on shadcn/ui
// (shell/live/, compiled once by tools/live_components.mjs), addressed by the kappa of its own bytes and served once under the preview route with
// no network grant at all, draws any spec it is sent. The host sends it the projection of the spec as
// it stands (mid-stream, checked, proved) and the frame patches only the nodes whose kappa changed,
// so a change to the spec reaches the screen without a build or a reload.
let liveFrameReady = null;
function liveFrame() {
  return (liveFrameReady ??= (async () => {
    const text = async (p) => { const r = await fetch(new URL(p, BASE)); if (!r.ok) throw new Error(p + " answered " + r.status); return r.text(); };
    const fonts = {};
    for (const p of FONTS) { const r = await fetch(new URL(p, BASE)); if (r.ok) fonts[p] = b64(new Uint8Array(await r.arrayBuffer())); }
    const html = await withCoverResponder(frameHtml({ brandCss: await text("brand.css"), componentsCss: await text("live/components.css"), componentsJs: await text("live/components.js"), interpreter: prism.INTERPRETER, fonts }));
    await coreReady;
    const { path } = core.run({ op: "preview", kappa: await kappa(enc.encode(html)) });
    const url = new URL(path.slice(1), BASE);
    await grantPreview(previewId(url.pathname), []);
    await (await caches.open("previews")).put(url.pathname + "index.html", new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
    return url.href;
  })().catch((error) => { liveFrameReady = null; throw error; }));
}
const liveWindows = new Map(); // the frame's window -> the app it shows
const liveLatest = new Map();  // appId -> { raw, trust }
const livePending = new Set();
const liveShown = new Set();   // apps whose preview a streaming turn has pointed at the live frame
const liveTimes = [];          // patch to pixel, as each frame reports it
const themeOf = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");
// A frame is trusted to receive an app's spec only when it is an iframe of this page showing the live frame.
const isLiveFrame = (source) => !!liveFrameUrl && [...document.querySelectorAll("iframe")].some((f) => f.contentWindow === source && f.src.startsWith(liveFrameUrl));
let liveFrameUrl = null;
function sendLive(appId) {
  const latest = liveLatest.get(appId);
  if (!latest) return;
  const p = live.project(latest.raw);
  const message = { type: "live/projection", app: String(appId), root: p.root, logic: p.logic, logicKappa: p.logicKappa, nodes: p.nodes, trust: latest.trust, theme: themeOf(), edit: !!latest.edit };
  for (const [win, app] of liveWindows) { if (win.closed) liveWindows.delete(win); else if (app === appId) win.postMessage(message, "*"); }
}
// Coalesced to one projection per animation frame: a model streams far faster than a screen draws.
function pushLive(appId, raw, trust, edit = false) {
  liveLatest.set(appId, { raw, trust, edit });
  // An edit is one change a person just made: it goes now, not at the next frame, so the frame can paint
  // it on its own next frame. Only a model's stream, many changes a frame, is coalesced.
  if (edit) { livePending.delete(appId); sendLive(appId); return; }
  if (livePending.has(appId)) return;
  livePending.add(appId);
  requestAnimationFrame(() => { livePending.delete(appId); sendLive(appId); });
}
window.addEventListener("message", (e) => {
  const m = e.data;
  if (!m || typeof m.type !== "string" || !m.type.startsWith("live/") || !isLiveFrame(e.source)) return;
  // The frame reads its app from the address (a string); the host keys apps as the store does (a number).
  if (m.type === "live/hello") { const app = /^[0-9]+$/.test(String(m.app)) ? Number(m.app) : m.app; liveWindows.set(e.source, app); if (liveLatest.has(app)) sendLive(app); else refreshLive(app); return; }
  if (m.type === "live/painted") { if (m.changed) { liveTimes.push(m.ms); if (liveTimes.length > 200) liveTimes.shift(); } return; }
  // Everything else acts on an app: the one this frame was shown, never the one the message names.
  const appId = liveWindows.get(e.source);
  if (!appId) return;
  if (m.type === "live/patch" && Array.isArray(m.ops)) patchSpec(appId, m.ops, { author: "user", key: m.key || null }).catch(() => {});
  else if (m.type === "live/undo" || m.type === "live/redo") stepSpec(appId, m.type === "live/undo" ? "undo" : "redo").catch(() => {});
  else if (m.type === "live/point") { if (livePointed.get(appId)?.key === m.key) livePointed.delete(appId); else livePointed.set(appId, { key: m.key, kind: m.kind, edit: m.edit || {}, text: String(m.text || "").slice(0, 200) }); }
});
new MutationObserver(() => { for (const appId of liveLatest.keys()) pushLive(appId, liveLatest.get(appId).raw, liveLatest.get(appId).trust); }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
// The rules as they stand: the checked spec at its kernel phase, else what the model wrote, as a draft.
async function refreshLive(appId) {
  const json = await get("files", appId + ":prism/spec.json");
  if (!json) return;
  const state = await rulesOf(appId);
  // The spec as written is drawn, not the checker's normalised copy: every edit path on the screen is a
  // path in this spec, so a click patches exactly what the model or the user wrote.
  try {
    const bound = state?.spec && state.specKappa === await kappa(enc.encode(json));
    const trust = bound ? state.phase === "published" && state.publicationCurrent === false ? "proved" : state.phase : "draft";
    pushLive(appId, JSON.parse(json), trust);
  } catch (e) {}
}

// ---- the one write path. A click on the screen and a patch the agent writes arrive here alike, as
// spec patches (shell/live/edit.mjs). Each is drawn at once (optimistic), then checked by Forge's
// checker in milliseconds; a patch that does not check is refused, the last good spec is drawn again,
// and the reason is shown on the node that was edited. A patch that checks is saved through the same
// path as a chat turn (rulesAfterTurn: the kernel's phase, the rule module) and sealed as a version.
// Patches to one app run one at a time, in order, so the user and the agent never race.
const liveEditors = new Map(); // appId -> its edit history
const livePointed = new Map(); // appId -> the node the user points the agent at
const liveQueue = new Map();
const checkForEdit = (spec) => { try { const c = prism.checkSpec(spec); return { ok: !!c.ok, issues: c.issues || [] }; } catch (e) { return { ok: false, issues: [String((e && e.message) || e)] }; } };
async function editorOf(appId, source) {
  const json = source ? new Map(source.files).get("prism/spec.json") : await get("files", appId + ":prism/spec.json");
  if (!json) return null;
  const spec = JSON.parse(json);
  let ed = liveEditors.get(appId);
  if (!ed) { ed = createEditor(spec, checkForEdit); liveEditors.set(appId, ed); } else ed.sync(spec);
  return ed;
}
const liveBusy = new Map(); // appId -> jobs queued or running
function inOrder(appId, job) {
  liveBusy.set(appId, (liveBusy.get(appId) || 0) + 1);
  const run = () => Promise.resolve().then(job).finally(() => { const n = liveBusy.get(appId) - 1; if (n) liveBusy.set(appId, n); else liveBusy.delete(appId); });
  const next = (liveQueue.get(appId) || Promise.resolve()).then(run, run);
  liveQueue.set(appId, next.catch(() => {}));
  return next;
}
function refuse(appId, key, message) {
  for (const [win, app] of liveWindows) if (app === appId && !win.closed) win.postMessage({ type: "live/refused", app: String(appId), key, message }, "*");
}
async function saveSpec(appId, spec, options = {}) {
  const result = await rulesAfterTurn(appId, "<prism-spec>" + JSON.stringify(spec) + "</prism-spec>", [], { onCommit: (oid) => emit("version-created", { appId, oid }), ...options });
  await refreshLive(appId);
  return result;
}
async function patchSpec(appId, ops, { author = "user", key = null, ...options } = {}) {
  ops = structuredClone(ops);
  // Optimistic, before anything is awaited: with the app's history already in memory and nothing ahead of
  // it in the queue, the patched spec is drawn now, then checked.
  const cached = liveEditors.get(appId);
  let drawn = false;
  if (cached && !liveBusy.has(appId)) { try { pushLive(appId, applyOps(cached.spec, ops), "draft", true); drawn = true; } catch (e) { if (!(e instanceof PatchError)) throw e; } }
  return inOrder(appId, async () => {
    assertGenerationActive(options.signal);
    const source = options.source || await captureProjectSource(await dbReady, appId);
    const ed = await editorOf(appId, source);
    if (!ed) return { ok: false, issues: ["This app has no rules yet."] };
    const before = ed.spec;
    try { if (!drawn) pushLive(appId, applyOps(before, ops), "draft", true); }
    catch (e) { if (!(e instanceof PatchError)) throw e; refuse(appId, key, e.message); return { ok: false, issues: [e.message] }; }
    const result = ed.apply(ops);
    if (!result.ok) { await refreshLive(appId); refuse(appId, key, result.issues[0]); return result; }
    try {
      const saved = await saveSpec(appId, result.spec, { ...options, source });
      return { ...result, ...saved };
    } catch (e) {
      liveEditors.delete(appId);
      await refreshLive(appId);
      refuse(appId, key, e.message);
      throw e;
    }
  });
}
async function stepSpec(appId, way) {
  return inOrder(appId, async () => {
    const source = await captureProjectSource(await dbReady, appId);
    const ed = await editorOf(appId, source);
    if (!ed || !(way === "undo" ? ed.canUndo : ed.canRedo)) return;
    const spec = way === "undo" ? ed.undo() : ed.redo();
    pushLive(appId, spec, "draft", true);
    try { await saveSpec(appId, spec, { source }); }
    catch (e) { liveEditors.delete(appId); await refreshLive(appId); refuse(appId, null, e.message); throw e; }
  });
}
// What the user points at, said to the agent with the request, so "make this cheaper" has a "this".
function pointedNote(appId) {
  const p = livePointed.get(appId);
  if (!p) return "";
  const paths = Object.entries(p.edit).filter(([, v]) => Array.isArray(v)).map(([slot, v]) => `${slot} at ${JSON.stringify(v)}`).join("; ");
  return `\n\n(The user is pointing at the ${p.kind} "${p.text}" on the screen${paths ? ": " + paths : ""}. To change it, write a <prism-spec-patch>.)`;
}
// Point the app's preview at the live frame. The iframe loads once: after this, the address it shows
// never changes for this app, so the preview never reloads.
async function showLive(appId) {
  liveShown.add(appId);
  liveFrameUrl = await liveFrame();
  const appUrl = liveFrameUrl + "#" + encodeURIComponent(appId);
  const m = machineOf(appId);
  if (m.state.phase === "ready" && m.state.url && m.state.url.appUrl === appUrl) return appUrl;
  // The renderer keeps the route the preview was on when the new address shares its origin (it expects
  // a dev server per app), and every preview here shares this origin; so a preview already showing
  // another page is first announced as restarting, the renderer's own signal to forget that route.
  if (m.state.url) publish(appId, { phase: "starting", operation: "restart", invocationRef: { kind: "app-run", entityKey: appId, operationId: "live-" + appId + "-" + Date.now() }, startedAt: Date.now(), operationError: null, exit: null });
  publish(appId, { phase: "ready", operation: null, invocationRef: null, startedAt: Date.now(), operationError: null, exit: null, url: { appUrl, originalUrl: appUrl, mode: "cloud" }, previewReloadEpoch: m.state.previewReloadEpoch + 1 });
  return appUrl;
}
const hasRules = async (appId) => !!(await get("files", appId + ":prism/spec.json"));
// Warm before the first spec: the frame is built (about 90 ms of fetching, encoding and hashing) and
// loaded once, hidden, while the page is idle, so the worker has it cached and its kernel has verified
// itself and answered the gate before a model writes a word. The hidden copy goes once it says hello.
function warmLive() {
  liveFrame().then((url) => {
    liveFrameUrl = url;
    const f = document.createElement("iframe");
    f.src = url + "#";
    f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
    f.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
    const done = (e) => { if (e.source === f.contentWindow && e.data && e.data.type === "live/hello") { window.removeEventListener("message", done); f.remove(); } };
    window.addEventListener("message", done);
    setTimeout(() => { window.removeEventListener("message", done); f.remove(); }, 15000);
    document.body.append(f);
  }).catch(() => {});
}
(window.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(warmLive, { timeout: 4000 });
window.__live = { liveFrame, showLive, pushLive, refreshLive, patchSpec, stepSpec, pointed: livePointed, times: liveTimes, project: live.project };

handlers.set("distributed-machine:subscribe", async ({ machineId, encodedKey }) => {
  if (machineId === "chat_stream") return chatSubscribe({ machineId, encodedKey });
  if (machineId !== "app_run") throw new Error("no browser machine " + machineId);
  const m = machineOf(encodedKey.appId);
  return { protocolVersion: 1, machineId, encodedKey, actorInstanceId: "web-app_run-" + encodedKey.appId, revision: m.revision, encodedState: m.state };
});
handlers.set("distributed-machine:unsubscribe", () => undefined);
handlers.set("distributed-machine:dispatch", async (envelope) => {
  const { machineId, encodedKey, messageId, encodedEvent } = envelope;
  if (machineId === "chat_stream") return chatDispatch(envelope);
  if (machineId !== "app_run") throw new Error("no browser machine " + machineId);
  const appId = encodedKey.appId, type = encodedEvent && encodedEvent.type;
  const receipt = (m) => ({ kind: "applied", actorInstanceId: "web-app_run-" + appId, revision: m.revision, transactionSequence: m.revision, messageId });
  if (type === "START" || type === "RESTART" || type === "MANUAL_RELOAD") {
    const op = type === "START" ? "run" : type === "RESTART" ? (encodedEvent.operation === "rebuild" ? "rebuild" : "restart") : "reload";
    // An app with rules is projected, not built: the live frame already shows it, so a start, restart
    // or reload keeps the frame (no epoch bump, no reload) and resends the rules.
    if (await hasRules(appId)) {
      try { await showLive(appId); await refreshLive(appId); }
      catch (e) { const m = publish(appId, { phase: "errored", operation: null, operationError: { message: String((e && e.message) || e) } }); return receipt(m); }
      const m = publish(appId, { lastSettlement: { operationId: encodedEvent.operationId || messageId, kind: "run", outcome: "succeeded" } });
      return receipt(m);
    }
    const m = publish(appId, { phase: type === "MANUAL_RELOAD" ? "reloading" : "starting", operation: op, startedAt: Date.now(), operationError: null, exit: null });
    (async () => {
      try {
        const { appUrl } = await buildPreview(appId);
        // A build that finishes after the app's rules took the preview (a model began writing a spec
        // while it ran) is about a page the app no longer shows: the live frame stays.
        if (liveShown.has(appId)) return;
        const cur = machineOf(appId);
        publish(appId, { phase: "ready", operation: null, url: { appUrl, originalUrl: appUrl, mode: "cloud" }, previewReloadEpoch: cur.state.previewReloadEpoch + 1, lastSettlement: { operationId: encodedEvent.operationId || messageId, kind: "run", outcome: "succeeded" } });
      } catch (e) {
        publish(appId, { phase: "errored", operation: null, operationError: { message: String((e && e.message) || e) }, lastSettlement: { operationId: encodedEvent.operationId || messageId, kind: "run", outcome: "failed", error: { message: String((e && e.message) || e) } } });
      }
    })();
    return receipt(m);
  }
  if (type === "STOP_REQUESTED") {
    const m = publish(appId, { phase: "stopped", operation: null, url: null, exit: { exitCode: 0, timestamp: Date.now() }, lastSettlement: { operationId: encodedEvent.operationId || messageId, kind: "stop", outcome: "succeeded" } });
    return receipt(m);
  }
  return { kind: "ignored", actorInstanceId: "web-app_run-" + appId, revision: machineOf(appId).revision, messageId, reason: "unknown intent " + type };
});
handlers.set("connection-flow:get-states", () => ({ github: { status: "disconnected", revision: 0 }, supabase: { status: "disconnected", revision: 0 }, neon: { status: "disconnected", revision: 0 } }));
handlers.set("window-infrastructure:attach-interest", () => undefined);
handlers.set("window-infrastructure:detach-interest", () => undefined);
// the renderer arbitrates the version preview between its windows: a window asks to own an app's preview
// before it may select a version, and the version controls refuse to work until it does. One tab owns
// everything here, so the interest is always granted and releasing it always starts the cleanup.
handlers.set("version-preview:acquire-window-interest", () => ({ acquired: true }));
handlers.set("version-preview:restore-window-interest", () => ({ acquired: true }));
handlers.set("version-preview:release-window-interest", () => ({ cleanupStarted: true }));
handlers.set("is-capacitor", () => false);
handlers.set("get-app-theme", () => null);
handlers.set("get-proposal", () => null);
handlers.set("select-app-for-preview", () => undefined);
handlers.set("git:get-uncommitted-files", () => []);
// Every edit here is sealed as it is made, so nothing is ever uncommitted; the diff of a file is still
// real -- its bytes now against its bytes at the address main points at.
handlers.set("git:get-uncommitted-file-diff", async ({ appId, filePath }) => {
  const snap = await snapshotOf(await get("refs", appId + ":main"));
  const entry = (snap ? snap.entries : []).find(([path]) => path === filePath);
  const now = await get("files", appId + ":" + filePath);
  return { path: filePath, oldContent: entry ? await contentAt(entry[1]) : "", newContent: now === undefined ? "" : now, additions: 0, deletions: 0 };
});
handlers.set("github:list-local-branches", () => ({ branches: ["main"], current: "main" }));
handlers.set("reload-env-path", () => undefined);
handlers.set("get-cloud-sandbox-status", () => null);
// The chat's context: which of the project's files a turn carries. the renderer keeps the globs on the app
// record and shows each one with what it matches, so the counts are measured here over the app's own
// files -- no glob library, the two wildcards the renderer's dialog writes are enough.
const globMatch = (glob, path) => new RegExp("^" + String(glob).split("**").map((s) => s.split("*").map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$").test(path);
async function contextCounts(appId, globs) {
  const paths = await filesOf(appId);
  const out = [];
  for (const { globPath } of globs || []) {
    let files = 0, chars = 0;
    for (const p of paths) if (globMatch(globPath, p)) { files += 1; chars += String((await get("files", appId + ":" + p)) || "").length; }
    out.push({ globPath, files, tokens: Math.ceil(chars / 4) });
  }
  return out;
}
handlers.set("get-context-paths", async ({ appId }) => {
  const c = ((await get("apps", appId)) || {}).chatContext || {};
  return {
    contextPaths: await contextCounts(appId, c.contextPaths),
    smartContextAutoIncludes: await contextCounts(appId, c.smartContextAutoIncludes),
    excludePaths: await contextCounts(appId, c.excludePaths),
  };
});
handlers.set("set-context-paths", async ({ appId, chatContext }) => { const a = await get("apps", appId); if (!a) throw new Error("no app " + appId); a.chatContext = chatContext; await put("apps", appId, a); });
// Unimplemented imported capabilities have no handler. The typed dispatch
// boundary reports unsupportedChannel, preserving the renderer error state.
window.__preview = buildPreview;

// ---- the model: OpenRouter with the visitor's own key, streamed as OpenAI compatible SSE. The key
// lives in the settings record as the renderer keeps it (providerSettings.openrouter.apiKey.value).
async function* streamOpenRouter({ key, model, messages, signal }) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: "Bearer " + key, "HTTP-Referer": location.origin, "X-Title": "hologram-forge" },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok) throw new Error("OpenRouter " + res.status + ": " + (await res.text()).slice(0, 200));
  const reader = res.body.getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try { const j = JSON.parse(data); const d = j.choices && j.choices[0] && j.choices[0].delta; if (d && d.content) yield d.content; if (j.error) throw new Error(j.error.message || "model error"); } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
    }
  }
}

// ---- the renderer's tags: what the model writes becomes files. The grammar is the renderer's: a block per
// file, attributes path and description, content verbatim between the tags; delete and rename are
// single tags; add-dependency names packages the import map must carry.
function parsePrismTags(text) {
  const writes = [], deletes = [], renames = [], deps = [];
  const attr = (s, name) => { const m = s.match(new RegExp(name + '="([^"]*)"')); return m ? m[1] : null; };
  for (const m of text.matchAll(/<prism-write\s+([^>]*)>([\s\S]*?)<\/prism-write>/g)) {
    let content = m[2]; if (content.startsWith("\n")) content = content.slice(1); if (content.endsWith("\n")) content = content.slice(0, -1);
    const fence = content.match(/^```[\w-]*\n([\s\S]*?)\n```\s*$/); if (fence) content = fence[1];
    writes.push({ path: attr(m[1], "path"), description: attr(m[1], "description"), content });
  }
  for (const m of text.matchAll(/<prism-delete\s+([^>]*?)\s*\/?>/g)) deletes.push({ path: attr(m[1], "path") });
  for (const m of text.matchAll(/<prism-rename\s+([^>]*?)\s*\/?>/g)) renames.push({ from: attr(m[1], "from"), to: attr(m[1], "to") });
  for (const m of text.matchAll(/<prism-add-dependency\s+([^>]*?)\s*\/?>/g)) { const p = attr(m[1], "packages") || attr(m[1], "package"); if (p) deps.push(...p.split(/\s+/).filter(Boolean)); }
  return { writes, deletes, renames, deps };
}
async function applyPrismTags(appId, tags, options = {}) {
  await coreReady;
  const result = await applyStoredProjectPatch(await dbReady, appId, tags, { core, derive: kappa, ...options });
  return result;
}
window.__chat = { streamOpenRouter, parsePrismTags, applyPrismTags };

// ---- the chat stream machine. the renderer submits a turn only here: SUBMIT on the chat_stream
// machine, then it watches the snapshot (admitting, streaming, finalizing, idle) and applies the
// chunk events to the message it renders. The model is OpenRouter with the visitor's own key; the
// prompt is the renderer's text tag build prompt, so the answer carries <prism-write> blocks the host applies
// to the project, seals as a version, and the renderer then reloads the preview by itself.
const chatMachines = new Map(); // chatId -> { revision, state, abort }
const idleChat = (chatId) => ({ schemaVersion: 1, chatId, revision: 0, phase: "idle", invocationRef: null, error: null, queueRevision: 0, queuePaused: false, queuePauseReason: null, queue: [], stopPolicyVersion: 0, capabilities: { canSubmit: true, canCancel: false, canPauseQueue: true, canResumeQueue: false }, lastAcceptance: null, lastCompletion: null, lastQueueMutation: null });
function chatMachineOf(chatId) { if (!chatMachines.has(chatId)) chatMachines.set(chatId, { revision: 0, state: idleChat(chatId), abort: null }); return chatMachines.get(chatId); }
function publishChat(chatId, patch) {
  const m = chatMachineOf(chatId);
  m.revision += 1;
  const phase = patch.phase || m.state.phase;
  const queuePaused = patch.queuePaused === undefined ? m.state.queuePaused : patch.queuePaused;
  m.state = { ...m.state, ...patch, revision: m.revision, capabilities: { canSubmit: true, canCancel: phase === "admitting" || phase === "streaming", canPauseQueue: !queuePaused, canResumeQueue: queuePaused } };
  emit("distributed-machine:snapshot", { protocolVersion: 1, machineId: "chat_stream", encodedKey: { chatId }, actorInstanceId: "web-chat_stream-" + chatId, revision: m.revision, encodedState: m.state });
  // shellUpdate is declared below and read here before it exists while the host starts: var, and checked.
  if (shellUpdate && shellUpdate.waiting && !turnRunning()) setTimeout(reloadIfIdle, 1500);
  return m;
}
// ---- never cut a turn short. A turn (a build, a proof, a publish) runs in this page; reloading the page
// ends it here while a cloud model may go on generating its answer, holding the shared plan's one slot
// for minutes. So: a newer shell waits until no turn runs (the worker announces it, see sw.template.js);
// leaving the page while one runs asks first; and a turn a reload did cut is marked as cut, not left as a
// silent half message.
function turnRunning() { return [...chatMachines.values()].some((m) => ["admitting", "streaming", "finalizing", "cancelling"].includes(m.state.phase)); }
var shellUpdate = { waiting: false };
function reloadIfIdle() { if (shellUpdate.waiting && !turnRunning()) location.reload(); }
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (e) => {
  if (e.data && e.data.type === "shell-updated") { shellUpdate.waiting = true; reloadIfIdle(); }
});
addEventListener("beforeunload", (e) => { if (turnRunning()) { e.preventDefault(); e.returnValue = ""; } });
// A turn a reload cut: the last message of a chat left as an open reasoning block or empty. Nothing runs
// when the page starts, so such a message is never a live turn.
const CUT = "\n\n<prism-output type=\"warning\" message=\"This answer was interrupted: the page reloaded before it finished. Ask again.\"></prism-output>";
async function markInterruptedTurns() {
  for (const chat of await all("chats")) {
    const last = chat && chat.messages && chat.messages[chat.messages.length - 1];
    if (!last || last.role !== "assistant" || last.content.includes("<prism-output")) continue;
    const open = /^<think>/.test(last.content) && !last.content.includes("</think>");
    if (!open && last.content.trim()) continue;
    last.content = (open ? last.content + "</think>" : last.content) + CUT;
    await updateStoredChat(await dbReady, chat.id, { messages: chat.messages });
  }
}
markInterruptedTurns().catch((e) => console.warn("[host] marking interrupted turns", e));
const djb2 = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0; return h; };
const now = () => new Date().toISOString();
async function messagesOf(chatId) { const c = await get("chats", chatId); return c ? c.messages : []; }
async function saveMessages(chatId, messages) { return updateStoredChat(await dbReady, chatId, { messages }); }
// What the model is shown of the project: every path, and the source of the files a visitor's app
// is made of; the shadcn ui library files are named, not pasted, since the model knows them.
async function codebaseOf(appId, source) {
  const captured = source ? new Map(source.files) : null;
  const paths = captured ? [...captured.keys()] : await filesOf(appId);
  const parts = [];
  for (const p of paths) {
    if (p.startsWith("src/components/ui/")) continue;
    const c = captured ? captured.get(p) : await get("files", appId + ":" + p);
    parts.push(`<prism-file path="${p}">\n${c}\n</prism-file>`);
  }
  return "Files in the project:\n" + paths.join("\n") + "\n\n" + parts.join("\n\n");
}
// ---- proved rules. An app that decides something carries prism/spec.json, a Prism spec. Its build
// phase (drafting, checked, proving, proved, published) is the Forge kernel's answer, never this
// file's: the kernel is the Prism app whose state machine Lean proves (FK-01 to FK-04), so the chat
// can say proved only after Lean attested the current rules, and publish only proved rules. The
// state lives at refs["prism:<appId>"].
const kernelReady = import(new URL("kernel.js", BASE).href).then(() => self.ForgeKernel.load((p) => fetch(new URL(p, BASE))));
// The renderer's screens ask the kernel too, for the decisions it holds about them (the build screen's layout,
// what counts as this week): the answer is the kernel's, the screen only draws it. Nothing is asked before the
// guest has passed its pin and every acceptance vector.
window.__forgeKernel = Object.freeze({ ask: (line) => kernelReady.then((k) => k.ask(line)) });
// The build screen draws whichever layout the kernel last answered for this window's width, then asks again:
// the answer is asked here as soon as the kernel is ready, and on every resize, so the build screen starts in
// the kernel's layout instead of drawing the other one and remounting.
const askLayout = () => kernelReady.then((k) => k.ask("layout " + Math.max(0, Math.round(innerWidth)))).then((a) => { if (a === "tabs" || a === "split") { try { localStorage.setItem("holo.layout.narrow", a === "tabs" ? "1" : "0"); } catch (e) {} } }).catch(() => {});
askLayout();
addEventListener("resize", askLayout);
async function representationCommand(operation, input, reconstruct = false) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== (reconstruct ? "basis,bytes,identity" : "basis,bytes")) return { ok: false, code: "invalidRepresentation" };
  try { return { ok: true, value: await (reconstruct ? operation(input.bytes, input.identity, input.basis) : operation(input.bytes, input.basis)) }; }
  catch (error) { if (error instanceof RepresentationError) return { ok: false, code: error.code }; throw error; }
}
handlers.set("forge:pack-bytes", input => representationCommand(packBytes, input));
handlers.set("forge:unpack-bytes", input => representationCommand(unpackBytes, input, true));
handlers.set("forge:compose", async (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== "features,policy") return { ok: false, code: "malformedComposition", error: "Composition requires policy and features" };
  return admitWithGuest(await kernelReady, input.policy, input.features);
});
handlers.set("forge:work", async input => executeWorkWithGuest(await kernelReady, input));
const PHASES = ["drafting", "checked", "proving", "proved", "published"];
async function nextPhase(phase, event) {
  const answer = await (await kernelReady).ask(phase + " " + event);
  if (!PHASES.includes(answer)) throw new Error("the kernel answered " + answer + " to " + phase + " " + event);
  return answer;
}
const rulesOf = async (appId) => readBoundRules(await dbReady, appId, kappa);
const rulesSnapshotOf = async (appId) => readBoundRulesSnapshot(await dbReady, appId, kappa);
const saveRules = async (appId, state, expected, signal) => saveBoundRules(await dbReady, appId, state, kappa, expected, signal);
// After a turn: the spec the model wrote (if any) becomes prism/spec.json; new rules drop the proof
// (the kernel's edit), are checked (its check), and on a pass the app's rule module is written.
// Returns the files changed and the card that replaces the spec in the chat.
async function rulesAfterTurn(appId, text, written = [], options = {}) {
  assertGenerationActive(options.signal);
  await coreReady;
  const source = options.source || await captureProjectSource(await dbReady, appId);
  const files = new Map(source.files), writes = [];
  const stage = (path, content) => { if (files.get(path) !== content) { files.set(path, content); writes.push({ path, content }); } };
  // A LexLean module, when the model wrote one, carries the rules: the spec is read from it, keeping the
  // screen's words (purpose, view, meanings) the spec already had, since the module holds only the logic.
  const lex = lexlean.specFromTurn(text);
  if (lex && lex.error) return { changed: 0, source, card: `**Rules** · not read\n\n- ${lex.error}\n\nAsk me to fix the module.` };
  if (lex) {
    let words = {};
    try { const prev = JSON.parse(files.get("prism/spec.json") || "{}"); words = Object.fromEntries(["purpose", "view", "meanings"].filter((k) => prev[k] !== undefined).map((k) => [k, prev[k]])); } catch (e) {}
    text = "<prism-spec>" + JSON.stringify({ ...lex.spec, ...words }) + "</prism-spec>";
  }
  const tag = prism.parseSpecTag(text);
  if (tag && tag.spec) stage("prism/spec.json", JSON.stringify(tag.spec, null, 2) + "\n");
  // Every app's rules have a canonical LexLean source, whatever wrote them (a module, the on-device
  // model's JSON, a click or an agent's patch): the same meaning is always the same module bytes. It is
  // staged with the spec, so both land in the one source transaction.
  if (files.get("prism/spec.json")) {
    try { const c = lexlean.canonicalSource(JSON.parse(files.get("prism/spec.json"))); stage(`prism/${c.name}.lex.tex`, c.source); } catch (e) {}
  }
  const current = files.get("prism/spec.json"), snapshot = await rulesSnapshotOf(appId), before = snapshot.state;
  if (!current) return { changed: 0, source, card: tag && tag.error ? `**Rules** · not checked\n\n- ${tag.error}\n\nAsk me to fix the rules.` : null };
  const specKappa = await kappa(enc.encode(current));
  const proofKey = spec => live.kappaOfValue({ name: spec.name, logic: live.logicOf(spec) });
  if (before && before.specKappa === specKappa && writes.length === 0) return { changed: 0, source, card: tag ? prism.card(before) : null };
  let phase = before ? await nextPhase(before.phase, "edit") : "drafting";
  let logicKappa = null, retained = false;
  let checked;
  try { checked = prism.checkSpec(JSON.parse(current)); } catch (e) { checked = { ok: false, issues: ["The rules are not valid JSON: " + e.message] }; }
  if (checked.ok) {
    logicKappa = proofKey(checked.spec);
    if (before?.spec && before.logicKappa === logicKappa && proofKey(before.spec) === logicKappa) {
      const reword = await rewordPhase(before.phase);
      if (reword) { phase = reword; retained = true; }
    }
    if (!retained) phase = await nextPhase(phase, "check");
    stage("src/lib/prism.ts", checked.module);
    const page = files.get("src/pages/Index.tsx") || "";
    if (!page.includes("@/lib/prism") && !written.some((p) => p && p.startsWith("src/pages/"))) stage("src/pages/Index.tsx", prism.screenSource());
  }
  const notes = [...(tag && tag.repaired ? ["Forge repaired the JSON syntax the model wrote. Read the rules before you approve them."] : []), ...(checked.notes || [])];
  const state = { ...(retained ? before : {}), phase, specKappa, logicKappa, spec: checked.spec || null, issues: checked.issues, notes, vectors: checked.vectors || 0, proof: retained ? before.proof : null, updated: now() };
  // A semantic proof survives wording changes; a release still identifies the older bytes.
  if (retained && before.phase === "published" && before.specKappa !== specKappa) state.publicationCurrent = false;
  // Compare the captured lifecycle and install its successor in the source transaction.
  // A completed proof wins over this stale edit; no deleted-status interval is exposed.
  const applied = await applyStoredProjectPatch(await dbReady, appId, { writes, deletes: [], renames: [], deps: [] }, { core, derive: kappa, ...options, source, rulesUpdate: { expected: snapshot.expected, state } });
  assertGenerationActive(options.signal);
  return { changed: applied.changed, source: applied.source, card: prism.card(state) };
}
// The kernel's answer to a reword. A kernel guest older than the event (KERNEL_REV pins the guest the page
// runs) answers invalid; the edit is then decided as an edit, by the kernel's own answer to that, and the
// proof is dropped as before. Nothing here decides a phase.
async function rewordPhase(phase) {
  try { return await nextPhase(phase, "reword"); } catch (e) { return null; }
}
// Lean proves the rules on the hosted verifier; the kernel moves the phase on its attestation or its
// refusal. A proof whose logic changed meanwhile is dropped: it is about other rules. A reword meanwhile
// keeps it, since the logic kappa is the same. Resolves the prover's result, or null when the logic
// changed under it.
async function proveRules(appId, logicKey, onWait) {
  const state = await rulesOf(appId);
  if (!state || (state.logicKappa || state.specKappa) !== logicKey || state.phase !== "proving") return null;
  const result = await prism.prove(state.spec, { onWait }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  const phase = await nextPhase("proving", result.ok ? "attest" : "fail");
  let attempted;
  for (;;) {
    const latest = await rulesOf(appId);
    if (!latest || (latest.logicKappa || latest.specKappa) !== logicKey || latest.phase !== "proving") return null;
    const predecessor = JSON.stringify(latest);
    if (predecessor === attempted) return null;
    attempted = predecessor;
    // Reword can commit between this read and CAS. Retry the completed result,
    // not the prover, only while a new current predecessor has matching semantics.
    if (await saveRules(appId, { ...latest, phase, proof: result.ok ? result.record : null, axioms: result.ok ? result.axioms || {} : null, proofError: result.ok ? null : result.error, updated: now() }, latest)) break;
  }
  await put("audit", Date.now() + ":prism:" + appId, { timestamp_millis: Date.now(), principal: "app:" + appId, operation: "prism.rules.prove", resource: logicKey, outcome: result.ok ? "proved" : "refused" });
  await refreshLive(appId);
  return result;
}
// "approve" is the user's yes to the guarantees on the card: no model is asked. The answer is a
// message, and, when Lean was started, the proof to wait for.
async function approveRules(appId) {
  const state = await rulesOf(appId);
  if (!state) return { text: "This app has no rules to prove yet. Tell me what it decides and I will draft them." };
  if (state.phase === "proving") return { text: "Lean is already proving these rules." };
  if (state.phase === "proved" || state.phase === "published") return { text: "These rules are already proved by Lean." };
  if (state.phase !== "checked") return { text: "The rules are not checked yet, so there is nothing to approve. Ask me to fix them." };
  const phase = await nextPhase("checked", "approve");
  if (!await saveRules(appId, { ...state, phase, approved: now() }, state)) return { text: "The rules changed before approval was recorded. Check the current rules again." };
  await refreshLive(appId);
  return { text: prism.provingMessage(state.spec), spec: state.spec, prove: (onWait) => proveRules(appId, state.logicKappa || state.specKappa, onWait) };
}
// The approve turn stays open while Lean works, as a build turn stays open while the model writes:
// the renderer shows it working, the message counts the seconds, and the result completes it.
async function approveTurn(chatId, appId, messages, userId, ref, intentId) {
  const m = chatMachineOf(chatId);
  messages.push({ id: userId + 1, role: "assistant", content: "", approvalState: "approved", commitHash: null, createdAt: now() });
  const show = async (content) => {
    messages[messages.length - 1] = { ...messages[messages.length - 1], content };
    await saveMessages(chatId, messages);
    emit("chat:response:chunk", { chatId, invocationRef: ref, messages });
  };
  let started;
  try { started = await approveRules(appId); } catch (e) { started = { text: `<prism-output type="error" message="${String((e && e.message) || e).replace(/"/g, "'")}"></prism-output>` }; }
  await show(started.text);
  if (started.prove) {
    const abort = new AbortController(); m.abort = abort;
    const proof = started.prove((s) => { if (!abort.signal.aborted) show(started.text + `\n\nLean is working, ${s} s.`); });
    const stopped = new Promise((res) => abort.signal.addEventListener("abort", () => res("stopped")));
    const result = await Promise.race([proof, stopped]);
    m.abort = null;
    if (result === "stopped") {
      await show(started.text + "\n\nStopped watching. Lean keeps working; the result is kept with the app's rules.");
      proof.catch(() => {});
    } else {
      await show(started.text + "\n\n" + (result ? prism.proofMessage(started.spec, result) : "The rules changed while Lean worked, so this proof is about other rules and was dropped."));
    }
  }
  publishChat(chatId, { phase: "finalizing", error: null, lastCompletion: { intentId, invocationRef: ref, outcome: "completed", updatedFiles: false, suppressAutoReview: true, targetAppId: appId } });
  publishChat(chatId, { phase: "idle", invocationRef: null, queuePaused: false, queuePauseReason: null });
  emit("chat:stream:end", { chatId });
}
handlers.set("prism:status", async ({ appId }) => (await rulesOf(appId)) || null);

// "publish": the proved app built with the Prism SDK, as `npx prism-code` builds it when Docker is not on the
// machine: a repository from UOR-Foundation/template under the visitor's GitHub account, one commit (the
// commit prism-code makes, prism.templateCommit), the template's pages and bootstrap workflows (Lean export,
// Rust, WebAssembly; Lean checks every theorem in the gate), then GitHub Pages. The holo is fetched back and
// opened with prism-code's own code; only when every acceptance vector passes in its compiled guest does
// the kernel move the rules to published, and the preview shows the live app. The turn stays open and
// counts the build, like the approve turn; Stop stops watching, not the build on GitHub.
const prismCode = () => import("./prism-code/src/index.mjs");
async function publishTurn(chatId, appId, messages, userId, ref, intentId) {
  const m = chatMachineOf(chatId);
  messages.push({ id: userId + 1, role: "assistant", content: "", approvalState: "approved", commitHash: null, createdAt: now() });
  const show = async (content) => {
    messages[messages.length - 1] = { ...messages[messages.length - 1], content };
    await saveMessages(chatId, messages);
    emit("chat:response:chunk", { chatId, invocationRef: ref, messages });
  };
  const finish = () => {
    publishChat(chatId, { phase: "finalizing", error: null, lastCompletion: { intentId, invocationRef: ref, outcome: "completed", updatedFiles: false, suppressAutoReview: true, targetAppId: appId } });
    publishChat(chatId, { phase: "idle", invocationRef: null, queuePaused: false, queuePauseReason: null });
    emit("chat:stream:end", { chatId });
  };
  const rules = await rulesOf(appId);
  const settings = (await get("settings", "user")) || {};
  const token = settings.githubAccessToken && settings.githubAccessToken.value;
  const refusal = !rules || !rules.spec ? "This app has no rules to build yet. Tell me what it decides, approve the rules, then say publish."
    : rules.phase !== "proved" && rules.phase !== "published" ? (rules.phase === "checked" ? "Reply approve first: Lean proves the rules, then the Prism SDK builds them." : `The rules are ${rules.phase === "proving" ? "being proved by Lean; say publish when it is done" : "not checked yet; ask me to fix them"}.`)
    : !token ? "Publishing builds the app with the Prism SDK on GitHub Actions, in a public repository in your account. Connect GitHub in Settings, under Integrations, then say publish."
    : null;
  if (refusal) { await show(refusal); return finish(); }
  const spec = rules.spec;
  const head = `**Publishing ${spec.title}** with the Prism SDK on GitHub Actions, as \`npx prism-code\` builds it. The repository is public, so anyone can read its rules and LexLean model.`;
  let links = "", observing = true;
  const abort = new AbortController(); m.abort = abort;
  const step = (word, detail, extra) => {
    if (extra && extra.runs) links = `\n\n[Build run](${extra.runs["pages.yml"]}) · [Lean gate](${extra.runs["bootstrap.yml"]})`;
    if (observing && !abort.signal.aborted) show(`${head}\n\n${word}: ${detail}.${links}`);
  };
  const stopped = new Promise((res) => abort.signal.addEventListener("abort", () => res("stopped")));
  const t0 = Date.now();
  const build = buildOnGitHub({ token, spec, axioms: rules.axioms || {}, attestation: rules.proof && rules.proof.attestation_id, templateCommit: prism.templateCommit, open: async (bytes) => (await prismCode()).loadArchive(bytes), step, signal: abort.signal })
    .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  const result = await Promise.race([build, stopped]);
  observing = false;
  if (m.abort === abort) m.abort = null;
  if (result === "stopped") { await show(`${head}\n\nStopped browser requests. Work already submitted to GitHub may continue; say publish again to pick it up.${links}`); return finish(); }
  const row = (outcome, resource) => put("audit", Date.now() + ":publish:" + appId, { timestamp_millis: Date.now(), principal: "app:" + appId, operation: "prism.application.publish", resource, outcome });
  if (!result.ok) {
    await row("refused", (result.repository || "") + (result.sha ? "@" + result.sha : ""));
    const why = result.error || (result.vectors ? `${result.vectors.total - result.vectors.passed} of ${result.vectors.total} acceptance vectors failed in the built guest, or the live page names another holo` : "the build did not pass");
    await show(`${head}\n\nPublication verification failed: ${why}. Remote content may already be live; this does not undo the GitHub build.${links}`);
    return finish();
  }
  const next = await nextPhase(rules.phase, "publish");
  const current = await saveRules(appId, { ...rules, phase: next === "published" ? next : rules.phase, publishedAs: result.live, publicationCurrent: true, build: { repository: result.repository, sha: result.sha, fingerprint: result.fingerprint, vectors: result.vectors, runs: Object.fromEntries(Object.entries(result.runs).map(([w, r]) => [w, r.html_url])), at: now() }, updated: now() }, rules);
  if (!current) {
    await row("stale", result.live);
    await show(`${head}\n\nThe build completed for earlier rules and may already be live at ${result.live}. The current project has not been marked published. Check and approve the current rules before publishing them.${links}`);
    return finish();
  }
  await row("granted", result.live);
  // The preview shows what was published: the live app, from GitHub Pages.
  const run = machineOf(appId);
  publish(appId, { phase: "ready", operation: null, url: { appUrl: result.live, originalUrl: result.live, mode: "cloud" }, previewReloadEpoch: run.state.previewReloadEpoch + 1 });
  const minutes = Math.max(1, Math.round((Date.now() - t0) / 60000));
  await show(`${head}\n\n**Live:** ${result.live}\n\nBuilt by the Prism SDK on GitHub Actions in ${minutes} min: Lean export, Rust, WebAssembly, and Lean checked every theorem in the gate. Forge fetched the holo and replayed ${result.vectors.passed} of ${result.vectors.total} acceptance vectors in its compiled guest. Holo \`${String(result.fingerprint).slice(0, 12)}…\` · [repository](https://github.com/${result.repository})${links}`);
  finish();
}
window.__prism = { rulesAfterTurn, approveRules, rulesOf, nextPhase, check: prism.checkSpec };

async function chatTurn(chatId, intent) {
  const m = chatMachineOf(chatId);
  const chat = await get("chats", chatId);
  const appId = chat.appId;
  const ref = intent.invocationRef;
  const settings = (await get("settings", "user")) || DEFAULT_SETTINGS;
  const V = await viewReady();
  const chosen = (chat.modelSelection && chat.modelSelection.provider ? chat.modelSelection : settings.selectedModel) || {};
  // Only Featherless is offered as a cloud model now; a selection left on OpenRouter answers on the device.
  const paid = chosen.provider === "featherless" && chosen.name;
  const model = paid ? chosen.provider + "/" + chosen.name.replace(/^(openrouter|featherless)\//, "") : MODEL_ID;
  // T2: the user message, accepted
  const messages = await messagesOf(chatId);
  const userId = messages.length ? Math.max(...messages.map((x) => x.id)) + 1 : 1;
  messages.push({ id: userId, role: "user", content: intent.prompt, approvalState: null, commitHash: null, createdAt: now() });
  await saveMessages(chatId, messages);
  publishChat(chatId, { phase: "streaming", lastAcceptance: { intentId: intent.intentId, acceptance: "message-accepted", acceptedMessageId: userId } });
  emit("chat:stream:start", { chatId, invocationRef: ref });
  if (prism.isApproval(intent.prompt)) return approveTurn(chatId, appId, messages, userId, ref, intent.intentId);
  if (prism.isPublish(intent.prompt)) return publishTurn(chatId, appId, messages, userId, ref, intent.intentId);
  // T3: the assistant placeholder
  const projectSource = await captureProjectSource(await dbReady, appId);
  const head = projectSource.reference;
  const asstId = userId + 1;
  messages.push({ id: asstId, role: "assistant", content: "", approvalState: "approved", commitHash: null, sourceCommitHash: head, model, createdAt: now() });
  await saveMessages(chatId, messages);
  emit("chat:response:chunk", { chatId, invocationRef: ref, messages });
  let full = "", lastSent = "", updatedFiles = false, summary, error = null;
  const abort = new AbortController(); m.abort = abort;
  let provenance = null;
  const committed = [];
  const onCommit = (oid) => { committed.push(oid); updatedFiles = true; emit("version-created", { appId, oid }); };
  try {
    const app = await get("apps", appId);
    const rules = new Map(projectSource.files).get("AI_RULES.md");
    const history = messages.slice(0, -2).filter((x) => x.content).map((x) => ({ role: x.role, content: x.content }));
    const request = [
      { role: "system", content: buildSystemPrompt(rules) + "\n\n" + prism.SPEC_RULES },
      { role: "user", content: "This is my codebase. " + (await codebaseOf(appId, projectSource)) },
      { role: "assistant", content: "OK, got it. I'm ready to help" },
      ...history,
      { role: "user", content: intent.prompt + pointedNote(appId) },
    ];
    // The route table decides who answers: a sealed answer to the same request is served without
    // running anything; the device runs the Q engine; a paid model answers with the visitor's key;
    // NoKey, NoGpu and PaidOffline are answered with the View's words.
    // A build turn writes whole files: a cap that cuts the answer mid tag leaves a corrupt project, so
    // the paid route is given room for several files (the device's engine keeps its own smaller cap).
    // Featherless's GLM reasons for some 14,000 tokens before it writes, inside the same budget, so it gets
    // the most Featherless allows (32,768); 16,384 left a page cut off mid file.
    const body = { model, messages: request, max_tokens: !paid ? 2048 : chosen.provider === "featherless" ? 32768 : 16384, temperature: "0.7" };
    const hit = await lookup(body);
    const route = await routeOf(hit, body);
    // The View's no-key word names OpenRouter; a Featherless model is told about its own key.
    const word = route === "NoKey" && model.startsWith("featherless/") ? "Add your Featherless key in Settings, under Featherless, to use " + paidId(model) : await refusalWord(route);
    if (word) throw new Error(word);
    let lastSave = 0;
    const onText = async (t) => {
      full = t;
      let lcp = 0; while (lcp < lastSent.length && lcp < full.length && lastSent[lcp] === full[lcp]) lcp++;
      if (lcp < lastSent.length) { messages[messages.length - 1].content = full; emit("chat:response:chunk", { chatId, invocationRef: ref, messages }); }
      else emit("chat:response:chunk", { chatId, invocationRef: ref, streamingMessageId: asstId, streamingPatch: { offset: lcp, content: full.slice(lcp), ...(lcp > 0 ? { prefixHash: djb2(full.slice(0, lcp)) } : {}) } });
      lastSent = full;
      // The rules as far as the model has written them go to the live frame now, not after the turn.
      if (full.includes("<prism-spec>")) {
        const raw = live.partialSpec(full);
        if (raw) { if (!liveShown.has(appId)) { liveShown.add(appId); showLive(appId).catch(() => liveShown.delete(appId)); } pushLive(appId, raw, "draft"); }
      } else if (full.includes("<prism-lexlean>")) {
        // A canonical LexLean module is the source: whatever declarations are whole are projected now.
        // The frame opens on the tag, not on the first whole declaration (thousands of characters
        // later), so it has mounted by the time there is something to paint.
        if (!liveShown.has(appId)) { liveShown.add(appId); showLive(appId).catch(() => liveShown.delete(appId)); }
        const part = lexlean.partialFromTurn(full);
        if (part) pushLive(appId, part.spec, "draft");
      }
      if (Date.now() - lastSave > 150) { messages[messages.length - 1].content = full; await saveMessages(chatId, messages); lastSave = Date.now(); }
    };
    // A model streams far faster than a screen draws, and every onText walks the whole answer and redraws the
    // message: deltas are coalesced to one onText per animation frame. The final text is delivered by onText
    // itself after the stream, and drops whatever frame is still pending.
    let pendingText = null, frame = 0;
    const onTextSoon = (t) => { pendingText = t; if (!frame) frame = requestAnimationFrame(() => { frame = 0; const next = pendingText; pendingText = null; if (next !== null) onText(next); }); };
    const settleText = () => { if (frame) cancelAnimationFrame(frame); frame = 0; pendingText = null; };
    // A LexLean module that does not read gets one repair turn from the same model, with the reader's
    // words, streamed into this answer, so the user sees a fixed app rather than an error to relay.
    const repaired = async (genBody) => {
      const before = full;
      const next = await lexlean.withRepair(before, async (prompt) => {
        const ask = { ...genBody, messages: [...genBody.messages, { role: "assistant", content: before }, { role: "user", content: prompt }] };
        const { text } = await paidGenerate(ask, (t) => onTextSoon(before + "\n\n" + t), abort.signal);
        settleText();
        return text;
      });
      if (next !== before) await onText(next);
    };
    // Warm up: the local model is chosen but not resident yet; a held key (the visitor's, or the
    // site's) answers through OpenRouter meanwhile, and the local model starts loading for the next turn.
    const warm = route === "Local" && !engine.instance && core.run({ op: "warmup", localReady: !!engine.instance, keyPresent: !!(await inference.keyGet()), online: navigator.onLine }).warmup;
    if (warm && navigator.gpu) gpuReady().catch(() => {});
    if (route === "Serve") {
      await onText(hit.text);
      provenance = { receipt: hit.receipt, served: true, fingerprint: hit.fingerprint };
    } else if (warm) {
      const warmBody = { ...body, model: "openrouter/" + (site.model || V.paidModels[0].id) };
      const warmHit = await lookup(warmBody);
      if (warmHit.hit) { await onText(warmHit.text); provenance = { receipt: warmHit.receipt, served: true, fingerprint: warmHit.fingerprint, warm: true }; }
      else {
        const { text, rec } = await paidGenerate(warmBody, onTextSoon, abort.signal);
        settleText();
        await onText(text);
        await repaired(warmBody);
        provenance = { receipt: await sealPaid(warmBody, rec, warmHit.key), fingerprint: `${rec.model};${rec.provider || ""}`, cost: rec.cost, warm: true };
      }
    } else if (route === "Paid") {
      // Until the answer starts, the model's reasoning shows in Prism's open Thinking block; the answer
      // replaces it, so the saved message, the history and the rules read only what the model answered.
      const thinking = (r) => onTextSoon("<think>" + r.replace(/<(\/?)(prism|think)/g, "＜$1$2"));
      const { text, rec } = await paidGenerate(body, onTextSoon, abort.signal, thinking);
      settleText();
      await onText(text);
      await repaired(body);
      // An answer cut at the token limit is not sealed, so the same request is never served it again.
      provenance = rec.finish === "length" ? { cut: true } : { receipt: await sealPaid(body, rec, hit.key), fingerprint: `${rec.model};${rec.provider || ""}`, cost: rec.cost };
    } else {
      // The device. Its window is about 3,000 tokens and a build request is several times that, so the
      // device is asked only for the app's rules, with a prompt that fits, by the rules model (the chat
      // ladder's models cannot write them); Forge draws the screen from the rules after the turn.
      if (!engine.rules) await onText("Loading the on-device rules model…");
      const held = await rulesModel();
      const inst = held.instance;
      // Rules that checked are the base of an edit. Rules that did not are left out: given them, the small
      // model copies them back unchanged, so it is asked again from the user's own words, every request so far.
      const current = await rulesOf(appId);
      const capturedSpec = new Map(projectSource.files).get("prism/spec.json");
      const currentMatches = typeof capturedSpec === "string" && current?.specKappa === await kappa(enc.encode(capturedSpec));
      const asks = messages.filter((x) => x.role === "user" && x.content && !prism.isApproval(x.content)).map((x) => x.content);
      const deviceMessages = currentMatches && current.spec && current.phase !== "drafting"
        ? prism.deviceRequest(intent.prompt, capturedSpec)
        : prism.deviceRequest(asks.join("\n"), null);
      const { ids } = gpuIds(inst, deviceMessages, held.model);
      const room = held.model.ctx - ids.length - 8;
      if (room < 128) throw new Error("This request does not fit the on-device model. Choose a paid model in the model picker.");
      await onText("");
      // No repetition penalty: rules are JSON, which repeats its keys by nature, and a penalty pushes a
      // small model off valid syntax. The receipt records the penalty used, so the answer stays re-derivable.
      const maxNew = Math.min(held.model.cap, room);
      const res = await withEngine(() => inst.generate(ids, { maxNew, repPenalty: 1, onToken: ({ text }) => { if (!abort.signal.aborted) onTextSoon(text); } }));
      settleText();
      const text = prism.withoutThinking(res.text);
      window.__prism.lastDevice = res.text || "";
      messages[messages.length - 1].model = "webgpu:" + held.model.fam; // the model that wrote the rules
      rememberSession(deviceMessages, res, text, held.model);
      await onText(/<prism-spec>/.test(text) ? text : text + "\n\nThe on-device model did not write rules for this app. Ask again with the inputs and the answers, or choose a paid model in the model picker.");
      const rec = await inst.buildReceipt({ promptText: intent.prompt, ctxIds: [], turnIds: ids, outIds: res.outIds, paramsPatch: { repetitionPenalty: 1, maxTokens: maxNew } });
      provenance = { receipt: await sealAnswer(body, rec, hit.key), fingerprint: `${(rec.body["prov:used"] || {})["holo:model"]}` };
    }
    // T6: completed batches have their own committed snapshots.
    assertGenerationActive(abort.signal);
    const sm = full.match(/<prism-chat-summary>([\s\S]*?)<\/prism-chat-summary>/); summary = sm ? sm[1].trim() : undefined;
    if (summary && (!chat.title || chat.title === "New chat")) { await updateStoredChat(await dbReady, chatId, { title: summary }); }
    const tags = parsePrismTags(full);
    const applied = await applyPrismTags(appId, tags, { signal: abort.signal, source: projectSource, onCommit });
    let changed = applied.changed;
    const spec = await rulesAfterTurn(appId, full, tags.writes.map((w) => w.path), { signal: abort.signal, source: applied.source, onCommit });
    for (const match of full.matchAll(/<prism-spec-patch>([\s\S]*?)<\/prism-spec-patch>/g)) {
      assertGenerationActive(abort.signal);
      let ops; try { ops = JSON.parse(match[1]); } catch {}
      const result = ops ? await patchSpec(appId, Array.isArray(ops) ? ops : [ops], { author: "agent", signal: abort.signal, source: spec.source, onCommit }) : { ok: false, issues: ["The patch is not JSON."] };
      if (!result.ok) spec.card = (spec.card ? spec.card + "\n\n" : "") + "**Patch refused.** " + result.issues[0];
      else { spec.changed += result.changed; spec.source = result.source; spec.card = result.card; }
    }
    changed += spec.changed;
    if (await hasRules(appId)) { await showLive(appId).catch(() => {}); await refreshLive(appId); }
    updatedFiles = updatedFiles || changed > 0;
    const commit = committed.at(-1) || null;
    messages[messages.length - 1] = { ...messages[messages.length - 1], content: prism.withCard(full, spec.card), commitHash: commit, approvalState: "approved", requestId: provenance && provenance.receipt || null };
    await saveMessages(chatId, messages);
    emit("chat:response:chunk", { chatId, invocationRef: ref, messages });
  } catch (e) {
    error = abort.signal.aborted ? null : String((e && e.message) || e);
    messages[messages.length - 1] = { ...messages[messages.length - 1], commitHash: committed.at(-1) || null, content: full + (updatedFiles ? "\n\nCommitted project changes were retained." : "") + (abort.signal.aborted ? "\n\n<prism-output type=\"warning\" message=\"Response cancelled by user\"></prism-output>" : error ? `\n\n<prism-output type="error" message="${error.replace(/"/g, "'")}"></prism-output>` : "") };
    await saveMessages(chatId, messages);
    emit("chat:response:chunk", { chatId, invocationRef: ref, messages });
  }
  m.abort = null;
  const outcome = abort.signal.aborted ? "cancelled" : error ? "errored" : "completed";
  const completion = { intentId: intent.intentId, invocationRef: ref, outcome, updatedFiles, suppressAutoReview: true, targetAppId: appId, ...(summary ? { chatSummary: summary } : {}), ...(error ? { error } : {}), ...(provenance && provenance.cut ? { warningMessages: ["The model ran out of room before it finished; an unfinished file was not written."] } : {}), ...(provenance && provenance.receipt ? { warningMessages: [(provenance.warm ? V.warmupLabel + " · " : "") + (provenance.served ? V.servedLabel : V.sealedLabel) + " · " + provenance.receipt.replace(/^blake3:/, "").slice(0, 12) + "…"] } : {}) };
  publishChat(chatId, { phase: "finalizing", error, lastCompletion: completion });
  publishChat(chatId, { phase: outcome === "errored" ? "errored" : "idle", invocationRef: null, queuePaused: false, queuePauseReason: null });
  emit("chat:stream:end", { chatId });
}
const chatSubscribe = ({ machineId, encodedKey }) => { const m = chatMachineOf(encodedKey.chatId); return { protocolVersion: 1, machineId, encodedKey, actorInstanceId: "web-chat_stream-" + encodedKey.chatId, revision: m.revision, encodedState: m.state }; };
function chatDispatch({ encodedKey, messageId, expectedActorInstanceId, encodedEvent }) {
  const chatId = encodedKey.chatId, m = chatMachineOf(chatId), type = encodedEvent && encodedEvent.type;
  const aid = "web-chat_stream-" + chatId;
  if (expectedActorInstanceId && expectedActorInstanceId !== aid) return { kind: "rejected", messageId, reason: "stale-actor" };
  const applied = () => ({ kind: "applied", actorInstanceId: aid, revision: m.revision, transactionSequence: m.revision, messageId });
  if (type === "SUBMIT") {
    const intent = encodedEvent.intent;
    if (m.state.phase === "admitting" || m.state.phase === "streaming") return { kind: "ignored", actorInstanceId: aid, revision: m.revision, transactionSequence: m.revision, messageId, reason: "not-active" };
    publishChat(chatId, { phase: "admitting", invocationRef: intent.invocationRef, error: null, queuePaused: false, queuePauseReason: null });
    chatTurn(chatId, intent).catch((e) => { console.error("[host] chat turn", e); publishChat(chatId, { phase: "errored", invocationRef: null, error: String((e && e.message) || e) }); });
    return applied();
  }
  if (type === "CANCEL") {
    if (m.abort) m.abort.abort();
    publishChat(chatId, { phase: m.abort ? "cancelling" : m.state.phase, stopPolicyVersion: m.state.stopPolicyVersion + 1 });
    return applied();
  }
  if (type === "REPORT_ERROR") { publishChat(chatId, { error: encodedEvent.error }); return applied(); }
  if (["PAUSE_QUEUE", "RESUME_QUEUE", "CLEAR_QUEUE", "EDIT_QUEUE_ENTRY", "REORDER_QUEUE_ENTRY", "REMOVE_QUEUE_ENTRY"].includes(type)) {
    publishChat(chatId, { queuePaused: type === "PAUSE_QUEUE", queuePauseReason: type === "PAUSE_QUEUE" ? "manual" : null, queueRevision: m.state.queueRevision + 1, lastQueueMutation: { mutationId: encodedEvent.mutationId, outcome: "applied" } });
    return applied();
  }
  return { kind: "ignored", actorInstanceId: aid, revision: m.revision, transactionSequence: m.revision, messageId, reason: "unknown intent " + type };
}
handlers.set("chat:observe-submission-stop-policy", (chatId) => chatMachineOf(chatId).state.stopPolicyVersion);
handlers.set("chat:cancel", (chatId) => { const m = chatMachineOf(chatId); if (m.abort) m.abort.abort(); });

// ---- the typed host boundary (FoundrySpecification.hostResponseBoundary)
function dispatch(channel, args) {
  seen.set(channel, (seen.get(channel) || 0) + 1);
  const output = window.__contracts && window.__contracts[channel];
  const input = window.__inputContracts && window.__inputContracts[channel];
  return invokeHost(channel, args, handlers.get(channel), output, output || input ? { schema: input } : null);
}




// ---- publish: a version becomes a Hologram application. The View is the project's built page with
// every dependency bundled in (a portable View has no network); the guest is this very core; the model
// document and the source manifest are the core's bytes; PrismPM's own archive code, vendored verbatim
// into the core, composes the .holo v4 and validates it; the archive is kept at its address, unpacked
// under holoPath(κ) for the worker, and offered as one link and one download. The core decides first:
// the shell closure of this page must be the closure the lane recorded beside the core, and the
// lane's attestation must be present; otherwise the View's refusal word and an audit row.
async function buildPortable(appId, captured) {
  await coreReady;
  const source = captured || await verifiedBuildSource(appId);
  const t0 = performance.now();
  const files = new Map(source.files);
  const pkg = await (await fetch(new URL("scaffold/package.json", BASE))).json();
  const pkgs = Object.fromEntries(Object.entries(pkg.dependencies).map(([n, v]) => [n, v.replace(/^[\^~]/, "")]));
  for (const d of source.dependencies) { const at = d.lastIndexOf("@"); if (at > 0) pkgs[d.slice(0, at)] = d.slice(at + 1); else pkgs[d] = ""; }
  // Every package resolves to one esm.sh URL and is fetched once; react and react-dom are external
  // to every other package so one React is bundled; the output is one script with no imports left.
  const urlOf = (name) => {
    const bare = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
    const sub = name.slice(bare.length), v = pkgs[bare] ? "@" + pkgs[bare] : "";
    if (bare === "react") return `https://esm.sh/react${v}${sub}?target=es2022`;
    if (bare === "react-dom") return `https://esm.sh/react-dom${v}${sub}?target=es2022&external=react`;
    return `https://esm.sh/${bare}${v}${sub}?target=es2022&external=react,react-dom`;
  };
  return withBuildModules(async remote => {
  const tw = await (await fetch(new URL("scaffold/tailwind.config.ts", BASE))).text();
  const m = tw.match(/theme:\s*(\{[\s\S]*\n  \}),\n  plugins/);
  const tailwindConfig = m ? "{darkMode:['class'],theme:" + m[1] + "}" : "{}";
  const exts = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];
  const resolveFile = (p) => { for (const e of exts) if (files.has(p + e)) return p + e; return null; };
  const plugin = { name: "portable", setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.namespace === "http") {
        if (/^https?:\/\//.test(args.path) || args.path.startsWith("/") || /^\.\.?\//.test(args.path)) return { path: new URL(args.path, args.importer).href, namespace: "http" };
        return { path: urlOf(args.path), namespace: "http" };
      }
      if (args.kind === "entry-point") { const r = resolveFile(args.path); if (r) return { path: r, namespace: "project" }; }
      if (args.path.startsWith("@/")) { const r = resolveFile("src/" + args.path.slice(2)); if (r) return { path: r, namespace: "project" }; }
      if (/^\.\.?\//.test(args.path) || args.path.startsWith("/")) {
        const base = args.importer ? args.importer.split("/").slice(0, -1).join("/") : "src";
        const norm = new URL(args.path, "file:///" + base + "/").pathname.slice(1);
        const r = resolveFile(norm); if (r) return { path: r, namespace: "project" };
        return { errors: [{ text: "not in project: " + norm }] };
      }
      if (/^https?:\/\//.test(args.path)) return { path: args.path, namespace: "http" };
      return { path: urlOf(args.path), namespace: "http" };
    });
    b.onLoad({ filter: /.*/, namespace: "http" }, async (args) => {
      const text = await remote.fetchText(args.path);
      return { contents: text, loader: /\.css(\?|$)/.test(args.path) ? "css" : "js" };
    });
    b.onLoad({ filter: /.*/, namespace: "project" }, (args) => {
      const src = files.get(args.path);
      if (args.path.endsWith(".css")) return { contents: src.replace(/@tailwind[^;]*;/g, ""), loader: "css" };
      return { contents: src, loader: args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".ts") ? "ts" : "jsx" };
    });
  } };
  const es = await esbuild();
  const r = await es.build({ entryPoints: ["src/main.tsx"], bundle: true, write: false, format: "esm", target: "es2022", jsx: "automatic", plugins: [plugin], outdir: "out", logLevel: "silent", minify: true,
    define: { "import.meta.env.DEV": "false", "import.meta.env.MODE": '"production"', "import.meta.env.BASE_URL": "__HOLO_BASE__", "process.env.NODE_ENV": '"production"' } });
  const js = r.outputFiles.find((f) => f.path.endsWith(".js")).text;
  const css = (r.outputFiles.find((f) => f.path.endsWith(".css")) || { text: "" }).text;
  // Tailwind, compiled once at publish: the play build cannot be fetched (its CDN sends no CORS
  // header), so the page is loaded once, hidden, under a preview address with the play build as a
  // script tag; the build scans the page (the bundle is inline, so every class it names is seen) and
  // the stylesheet it writes is taken as static CSS. The published page then needs no network and no
  // compiler to style itself.
  const inline = (s) => s.replace(/<\/script/g, "<\\/script");
  const body = `<style>${css}</style></head><body><div id="root"></div>\n<script type="module">${inline(js)}<\/script></body></html>`;
  const head = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<script>var __HOLO_BASE__ = location.pathname.replace(/index\\.html$/, "");`;
  // Every class like token of the bundle, the project's CSS and its HTML, listed once in a hidden
  // element, so the compiler's first scan already sees every candidate whether or not the page has
  // rendered it yet; the compile is then judged by the rendered page: no class in use without a rule.
  const candidates = [...new Set((js + " " + css).match(/[A-Za-z][A-Za-z0-9_\-:\/\.\[\]#%!]*/g) || [])].filter((t) => t.length < 120).join(" ");
  const compilePage = head + ` tailwind = { config: ${tailwindConfig} };<\/script>\n<script src="https://cdn.tailwindcss.com"><\/script>\n<div hidden id="tw-candidates" class="${candidates.replace(/"/g, "")}"></div>\n` + body;
  const tailwindCss = await compileTailwind(compilePage);
  const html = head + `<\/script>\n<style>${tailwindCss}</style>\n` + body;
  await assertBuildSourceCurrent(await dbReady, appId, source);
  return { html, sourceReference: source.reference, modules: remote.count, jsBytes: js.length, cssBytes: css.length, tailwindBytes: tailwindCss.length, ms: Math.round(performance.now() - t0) };
  });
}
// Runs inside the compile frame. The frame is a preview address, so the worker serves it in a CSP
// sandbox with an opaque origin and the host cannot read its document: the frame reports instead,
// every 250 ms, the compiled sheet, whether the app rendered, and the classes in use that no rule
// covers. A report is the app's own word about its own styles; a false one can only spoil that app.
function tailwindReporter() {
  const escapeClass = (c) => c.replace(/[^a-zA-Z0-9_-]/g, (m) => "\\" + m);
  setInterval(() => {
    const sheets = [...document.querySelectorAll("style")].map((s) => s.textContent);
    const root = document.getElementById("root");
    const all = sheets.join("\n");
    const used = new Set([...document.querySelectorAll("[class]")].filter((e) => e.id !== "tw-candidates").flatMap((e) => String(e.className.baseVal ?? e.className).split(/\s+/).filter(Boolean)));
    parent.postMessage({ tailwindReport: true, sheet: sheets.find((t) => t.includes("--tw-")) || "", rendered: !!(root && root.childElementCount), missing: [...used].filter((c) => !all.includes("." + escapeClass(c))) }, "*");
  }, 250);
}

async function compileTailwind(page) {
  const id = "tw-" + Date.now().toString(36);
  const path = new URL("p/" + id + "/index.html", BASE).pathname;
  const at = page.lastIndexOf("</body>");
  const reporting = page.slice(0, at) + `<script>(${tailwindReporter})();<\/script>` + page.slice(at);
  await grantPreview(id, ["https://cdn.tailwindcss.com"]);
  const cache = await caches.open("previews");
  await cache.put(path, new Response(reporting, { headers: { "content-type": "text/html; charset=utf-8" } }));
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:1280px;height:800px;left:-2000px;top:0;visibility:hidden";
  let report = null;
  const listen = (e) => { if (e.source === frame.contentWindow && e.data && e.data.tailwindReport) report = e.data; };
  window.addEventListener("message", listen);
  frame.src = path;
  document.body.append(frame);
  try {
    const t0 = performance.now();
    let last = "", stable = 0;
    while (performance.now() - t0 < 30000) {
      await new Promise((r) => setTimeout(r, 250));
      if (!report || !report.sheet || !report.rendered) continue;
      // Converged when the rendered page uses no class the compiled sheet (or the project's own CSS) lacks.
      // The sheet is inlined into a <style> element of the published page, so it may not close that element.
      const sheet = String(report.sheet).replace(/<\/style/gi, "<\\/style");
      const missing = Array.isArray(report.missing) ? report.missing.map(String) : [];
      const key = sheet.length + ":" + missing.join(",");
      if (key === last) { stable += 1; if (stable >= 3 && missing.length === 0) return sheet; if (stable >= 12) return sheet; } else { last = key; stable = 0; }
    }
    if (last) throw new Error("tailwind did not converge on the page");
    throw new Error("tailwind did not compile the page");
  } finally {
    window.removeEventListener("message", listen);
    frame.remove();
    await cache.delete(path);
    await del("refs", "capabilities:" + id);
  }
}
window.__portable = buildPortable;
const PROVENANCE_FIELDS = ["source_id", "semantic_id", "compiler_semantics_id", "snapshot_id", "stdlib_semantics_id", "prism_stdlib_crate_sha256", "lexlean_commit", "lexlean_package_sha256", "lean4_prod_commit", "hologram_live_commit", "uor_hologram_commit", "target_profile_id", "lean_manifest_sha256", "lcnf_manifest_sha256", "generated_core_sha256", "cargo_name", "cargo_version", "cargo_crate_sha256", "view_model_id", "browser_projection_sha256"];
let lastPublish = null;
const holoUrl = (k) => new URL(core.run({ op: "holo-path", kappa: k }).path.slice(1), BASE).href;
handlers.set("holo:view", async () => { await coreReady; return core.run({ op: "view" }); });
handlers.set("holo:list", async (appId) => { await coreReady; return (await installed()).filter((r) => r.appId === appId).map((r) => ({ ...r, url: holoUrl(r.kappa) })); });
handlers.set("holo:publish", async ({ appId }) => {
  await coreReady;
  const t0 = performance.now();
  const words = core.run({ op: "view" });
  const [manifest, provenance] = await Promise.all([
    fetch(new URL("manifest.json", BASE), { cache: "no-store" }).then((r) => r.json()),
    fetch(new URL("provenance.json", BASE), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const closure = manifest.closure, built = provenance ? provenance.browser_projection_sha256 || "" : "";
  const attestation = provenance && provenance.attestation_id ? provenance.attestation_id : null;
  const { decision } = core.run({ op: "publish-decision", closure, built, attestation });
  const captured = await verifiedBuildSource(appId);
  const app = { name: captured.name }, version = captured.reference;
  const row = (outcome, resource) => put("audit", Date.now() + ":publish:" + appId, { timestamp_millis: Date.now(), principal: "app:" + appId, operation: "holo.application.publish", resource, outcome });
  if (decision !== "Accept") { await row("refused", version || ""); return { decision, word: words.publishRefusedLabel, closure, built, attestation }; }
  // Cached proof status can be absent after an edit; source determines the publication route.
  if (requiresRulePublication(captured)) {
    await row("refused", version);
    return { decision: "Chat", word: "This app has rules, so it is built with the Prism SDK: say publish in the chat.", closure, built, attestation };
  }
  const page = await buildPortable(appId, captured);
  const view = encodeView([{ path: "index.html", bytes: enc.encode(page.html) }, { path: "build/modules.json", bytes: enc.encode(JSON.stringify(page.moduleClosure, null, 2) + "\n") }, ...page.moduleFiles]);
  const guest = new Uint8Array(await (await fetch(new URL("core.wasm", BASE), { cache: "no-store" })).arrayBuffer());
  const model = core.run({ op: "publish-preimage", application: app.name, version, closure, attestation }).bytes;
  const modelBytes = enc.encode(model);
  const modelId = await sha256(modelBytes);
  const source = core.run({ op: "source-manifest", leanManifest: provenance.lean_manifest_sha256, coverage: provenance.coverage_sha256, kernel: provenance.kernel_ir_sha256, modelId, semanticId: provenance.semantic_id, sourceId: provenance.source_id }).bytes;
  const sourceBytes = enc.encode(source);
  const prov = Object.fromEntries(PROVENANCE_FIELDS.map((k) => [k, provenance[k]]));
  const t1 = performance.now();
  const composed = core.run({ op: "compose", application: app.name, guest: b64(guest), view: b64(view), model: b64(modelBytes), source: b64(sourceBytes), provenance: prov });
  const composeMs = Math.round(performance.now() - t1);
  const bytes = unb64(composed.bytes);
  const address = await kappa(bytes);
  if (address !== composed.identities.archive_kappa) throw new Error("the page's address of the archive differs from PrismPM's: " + address);
  await assertBuildSourceCurrent(await dbReady, appId, captured);
  const done = await install(bytes, { appId, application: app.name, version });
  await row("granted", address);
  const record = { application: app.name, version, closure, attestation, provenance: prov, identities: composed.identities, directory: composed.directory, byteLength: bytes.length, modelId, viewBytes: view.length, guestBytes: guest.length };
  lastPublish = { record, bytes, guest, view, model: modelBytes, source: sourceBytes, page };
  return { decision, kappa: address, url: done.url, byteLength: bytes.length, viewBytes: view.length, guestBytes: guest.length, ms: Math.round(performance.now() - t0), buildMs: page.ms, composeMs, installMs: done.ms, modules: page.modules, jsBytes: page.jsBytes, cssBytes: page.cssBytes, tailwindBytes: page.tailwindBytes, identities: composed.identities, record };
});

window.electron = {
  ipcRenderer: {
    invokeEnvelope: (channel, ...args) => dispatch(channel, args),
    invoke: (channel, ...args) => dispatch(channel, args).then(unwrapHost),
    send: (channel) => { const n = (seen.get(channel) || 0) + 1; seen.set(channel, n); if (n === 1) console.warn("[host] send:", channel); },
    on: (channel, fn) => { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel).add(fn); return () => listeners.get(channel).delete(fn); },
    removeListener: (channel, fn) => { const set = listeners.get(channel); if (set) set.delete(fn); },
    removeAllListeners: (channel) => { listeners.delete(channel); },
  },
};
// The landing page keeps the visitor's first prompt; on arrival the builder creates the app from
// the scaffold, opens its chat and runs the turn, so the visitor lands in the renderer's UI mid build.
(async () => {
  let first = null;
  try { first = JSON.parse(sessionStorage.getItem("holo.first-prompt.v1") || "null"); sessionStorage.removeItem("holo.first-prompt.v1"); } catch (e) {}
  if (!first || !first.prompt) return;
  const name = ("app-" + first.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 40) || "app";
  const created = await handlers.get("create-app")({ name });
  const intent = { intentId: "first-" + Date.now(), chatId: created.chatId, invocationRef: { kind: "chat-stream", entityKey: created.chatId, operationId: "first-" + Date.now() }, prompt: first.prompt, redo: false, selectedComponents: [], requestedChatMode: "build" };
  publishChat(created.chatId, { phase: "admitting", invocationRef: intent.invocationRef, error: null });
  chatTurn(created.chatId, intent).catch((e) => console.error("[host] first turn", e));
  const base = new URL(document.baseURI).pathname;
  history.replaceState(null, "", base + "chat?id=" + created.chatId + "&appId=" + created.app.id);
  dispatchEvent(new PopStateEvent("popstate"));
})();
window.__host = { handlers, emit, seen, get, put, all, kappa, core: () => core, coreReady, view: () => coreReady.then((c) => c.run({ op: "view" })), publish: () => lastPublish };
if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", BASE)).catch(() => {});
// The worker installs only what a first paint needs; once this page has loaded and is idle it is asked to
// fill the rest of the closure (the engine, the chat app, the photos), so offline use follows soon after.
if ("serviceWorker" in navigator) {
  const idle = (fn) => (self.requestIdleCallback ? requestIdleCallback(fn, { timeout: 10000 }) : setTimeout(fn, 3000));
  addEventListener("load", () => idle(() => navigator.serviceWorker.ready.then((r) => r.active && r.active.postMessage("fill")).catch(() => {})), { once: true });
}
// After a deployment a page can run an entry that names a chunk the origin no longer serves: the worker has
// already revalidated the entry, so one reload runs the new build whole.
addEventListener("vite:preloadError", (event) => {
  const key = "holo.chunk.reloaded";
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  event.preventDefault();
  location.reload();
});
addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("holo.chunk.reloaded"), 10000), { once: true });
// Applications installed before the kernel's gate held no grant record, and the gate refuses to
// serve without one: each gets the grant install now writes, served with no network.
(async () => {
  await coreReady;
  for (const ref of await installed()) {
    const id = core.run({ op: "holo-path", kappa: ref.kappa }).path.split("/").filter(Boolean).pop();
    if (!(await get("refs", "capabilities:" + id))) await put("refs", "capabilities:" + id, { serve: true, network: { endpoints: [], denied: [] } });
  }
})().catch(() => {});
// One closure per page. A document can be served by a worker that installed an older shell while a
// newer one is published; then its scripts and the page disagree and a screen breaks for reasons that
// are not in the code. The worker names its cache after the closure it installed, and the origin serves
// the closure that is published, so the two are compared here and the page reloads itself once.
(async () => {
  const key = "holo.closure.reloaded";
  try {
    const names = await caches.keys();
    const running = (names.find((n) => n.startsWith("shell-")) || "").slice("shell-".length);
    const published = (await (await fetch(new URL("manifest.json", BASE), { cache: "no-store" })).json()).closure;
    if (!running || !published || running === published) { sessionStorage.removeItem(key); return; }
    if (sessionStorage.getItem(key) === published) { console.warn("[host] this page runs shell", running.slice(0, 12), "while", published.slice(0, 12), "is published; the worker could not take over"); return; }
    sessionStorage.setItem(key, published);
    console.warn("[host] a newer shell is published; reloading once", running.slice(0, 12), "->", published.slice(0, 12));
    location.reload();
  } catch (e) {}
})();
