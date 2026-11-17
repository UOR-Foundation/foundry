import { providerKeyFailure } from "./provider-key-validation.mjs";
// Typed adapter for FoundrySpecification.hostResponseBoundary. The schema belongs
// to the imported renderer contract; this adapter never invents a successful value.
const marker = "prism-ipc-envelope-v1";
const success = (value) => ({ __prismIpcEnvelope: marker, ok: true, value });
const refusal = (code, channel, kind, message) => ({
  __prismIpcEnvelope: marker,
  ok: false,
  error: { name: "PrismError", kind, code, message: `${message}: ${channel}` },
});

export async function invokeHost(channel, args, handler, schema, inputContract = null) {
  if (typeof handler !== "function") {
    return refusal("unsupportedChannel", channel, "not_found", "This capability is unavailable in the browser");
  }
  if (inputContract !== null) {
    let inputSchema;
    try {
      inputSchema = inputContract.schema;
      if (!inputSchema || typeof inputSchema.safeParse !== "function") {
        return refusal("inputContractUnavailable", channel, "internal", "The browser input contract is unavailable");
      }
    } catch { return refusal("inputValidatorFailed", channel, "internal", "The browser input validator failed"); }
    if (!Array.isArray(args) || args.length > 1) {
      return refusal("invalidInput", channel, "validation", "The command arguments do not match their contract");
    }
    let input;
    try { input = structuredClone(args[0]); }
    catch { return refusal("invalidInput", channel, "validation", "The command cannot be transferred"); }
    try {
      const parsed = inputSchema.safeParse(input);
      if (parsed?.success !== true) {
        return refusal("invalidInput", channel, "validation", "The command arguments do not match their contract");
      }
      if (!Object.hasOwn(parsed, "data")) {
        return refusal("inputValidatorFailed", channel, "internal", "The browser input validator returned no value");
      }
      args = [parsed.data];
    } catch { return refusal("inputValidatorFailed", channel, "internal", "The browser input validator failed"); }
  }
  let value;
  try {
    value = await handler(...args);
  } catch (error) {
    const known = providerKeyFailure(error);
    if (known) return refusal(known.code, channel, known.kind, known.message);
    return refusal("handlerFailed", channel, "internal", "The browser operation failed");
  }
  // Legacy channels without imported output contracts retain their handler result.
  // Their existence is not evidence of schema coverage or capability completeness.
  if (schema == null) return success(value);
  try {
    if (schema.safeParse(value)?.success !== true) {
      return refusal("invalidResponse", channel, "internal", "The browser response did not match its contract");
    }
  } catch {
    return refusal("validatorFailed", channel, "internal", "The browser response validator failed");
  }
  return success(value);
}

// Both IPC entrypoints preserve the same typed failure. The renderer's generated
// client already decodes the envelope; older direct callers use this adapter.
export function unwrapHost(envelope) {
  if (envelope.ok) return envelope.value;
  throw Object.assign(new Error(envelope.error.message), envelope.error);
}
