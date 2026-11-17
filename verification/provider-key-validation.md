# Provider credential validation

Authority: `FoundrySpecification.providerKeyBoundary` and `ProviderKeyError`.
FA-16 replaces the browser's unconditional success for non-OpenRouter keys with
explicit `unsupportedProvider` refusal. OpenRouter success now requires a bounded
HTTP 200 JSON authentication response containing a nonempty label and Boolean
`is_free_tier`. This validates authentication metadata, not inference entitlement,
model availability or balance. Google and Prism automatic-provider checks remain
unavailable in the browser; their credentials are never transmitted here.

The key is sent only to the fixed HTTPS auth/key endpoint in a Bearer header.
Redirects are refused, cookies omitted and caching disabled. The command does not
store credentials. Keys are nonempty printable ASCII, limited to 8192 characters.
A maximum 20-second deadline covers headers and body, with a 65536-byte body limit
and fatal UTF8 decoding. Cancellation, status, malformed data, excessive body size
and transport failures have ten modeled error categories. The host preserves only
the fixed public category and message, even if an exception message was changed;
unknown exceptions retain generic redaction.

The ID, scenario and failing test preceded implementation. Eight Node controls
cover input refusal before effects, fixed transmission policy, statuses, malformed
metadata, body limits, deadlines, cancellation, safe host errors and actual command
delegation. Chromium verifies success, refusal to follow redirects, timeout and
cancellation after response headers; two stalled server connections close and no
redirect target is reached. The initial browser harness incorrectly treated the
favicon request as authenticated traffic; its route handling was corrected before
recording the passing result. No live credential or provider availability test is
claimed.

Returning success for an unsupported provider, accepting malformed metadata, or
removing the body limit each fails the eight-control suite. All three mutations
were restored. Complete local Rust tests, Clippy, shell parsing and renderer
error recovery pass; full locked-SDK and Studio qualification is recorded at the
feature PR revision.
