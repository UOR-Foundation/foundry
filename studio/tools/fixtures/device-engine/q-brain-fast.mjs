// Test fixture, served in place of shell/q/core/q-brain-fast.mjs (see loader.js beside it).
export const frameHistory = (entry, messages) => (messages || []).map((m) => `${m.role}: ${m.content}`).join("\n");
