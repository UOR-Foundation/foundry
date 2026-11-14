// Test fixture, served in place of shell/q/core/loader.js by the browser suites' own servers
// (tools/device_fixture.mjs), never by the shell. It holds the catalogue entries the shell names and
// "loads" each without a GPU or a download: the weights are read back by an image address, as the real
// loader reports them, so Prism R4 judges the fixture's answers as it judges the device model's.
export const MODELS = ["TernaryBonsai", "Bonsai", "SmolLM2", "BitNet"].map((fam) => ({ fam, name: `${fam} · fixture`, cap: 256, ctx: 3000 }));
export const defaultModelIndex = () => 0;
export const MCACHE = "holo-q-models-fixture";
export async function ready() {}
export async function refreshCached() { return new Set(); }
export const isCached = () => true;
export async function deleteCache() {}
export function armTokenizer() { return false; }
export async function loadFromQ() { return null; }
export async function loadModel(entry) {
  return { gpu: true, entry, imageKappa: "sha256:" + "a".repeat(64) };
}
