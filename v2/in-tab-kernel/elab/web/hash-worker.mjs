// One hashing worker of the elaborator worker's pool: BLAKE3 κ (prism-code's) of the bytes it is given, which it
// hands back with the label, so checking 375 MB of library runs on every core instead of one.
import { kappa } from "./blake3.mjs";
self.onmessage = ({ data: { id, bytes } }) => self.postMessage({ id, kappa: kappa(bytes), bytes }, [bytes.buffer]);
