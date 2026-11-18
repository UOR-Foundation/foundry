// A read-only WASI (preview 1) host for LexLean's front end in a browser worker.
//
// Why: `lexlean check` (and the print-only commands built on it) reads a project and writes only to standard output;
// a browser has no file system, so the project is handed over as bytes. How: one preopened directory `/`, holding the
// project's files from memory; reads, directory listings and file status are answered from that tree; every call that
// would change it answers EROFS, so a command that tries to write is refused, never silently given a fake disk.
// Standard input is empty; standard output and error are collected. Each file has its own inode number, so LexLean's
// same-file check (LLC0104, by device and inode on WASI) sees distinct files as distinct.
//
//   run(module, { args, env, files }) -> { exit, stdout, stderr }   files: Map of "dir/file" -> Uint8Array
const E = { SUCCESS: 0, BADF: 8, EXIST: 20, INVAL: 28, ISDIR: 31, NOENT: 44, NOSYS: 52, NOTDIR: 54, ROFS: 69 };
const DIR = 3, FILE = 4, CHAR = 2;
const OFLAGS_CREAT = 1, OFLAGS_DIRECTORY = 2, OFLAGS_TRUNC = 8;

class Exit { constructor(code) { this.code = code; } }

function tree(files) {
  let ino = 1n;
  const root = { kind: DIR, ino: ino++, entries: new Map() };
  for (const [path, bytes] of files) {
    const parts = path.split("/").filter(Boolean);
    let dir = root;
    for (const p of parts.slice(0, -1)) {
      if (!dir.entries.has(p)) dir.entries.set(p, { kind: DIR, ino: ino++, entries: new Map() });
      dir = dir.entries.get(p);
    }
    dir.entries.set(parts.at(-1), { kind: FILE, ino: ino++, bytes });
  }
  return root;
}

export function run(module, { args = ["lexlean"], env = {}, files = new Map() }) {
  const root = tree(files);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const out = { 1: [], 2: [] };
  const fds = new Map([[0, { kind: CHAR, stdin: true }], [1, { kind: CHAR }], [2, { kind: CHAR }], [3, { node: root, preopen: "/" }]]);
  let next = 4, memory;
  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);
  const str = (ptr, len) => dec.decode(bytes().subarray(ptr, ptr + len));
  const argv = args.map((a) => enc.encode(a + "\0"));
  const envv = Object.entries(env).map(([k, v]) => enc.encode(`${k}=${v}\0`));
  const lookup = (dirFd, path) => {
    const base = fds.get(dirFd);
    if (!base || !base.node || base.node.kind !== DIR) return [E.BADF];
    let node = path.startsWith("/") ? root : base.node;
    const stack = [];
    for (const p of path.split("/")) {
      if (p === "" || p === ".") continue;
      if (p === "..") { node = stack.pop() ?? root; continue; }
      if (node.kind !== DIR) return [E.NOTDIR];
      const child = node.entries.get(p);
      if (!child) return [E.NOENT];
      stack.push(node); node = child;
    }
    return [E.SUCCESS, node];
  };
  const filestat = (ptr, node) => {
    const v = view();
    for (let i = 0; i < 64; i += 8) v.setBigUint64(ptr + i, 0n, true);
    v.setBigUint64(ptr, 1n, true);
    v.setBigUint64(ptr + 8, node.ino ?? 0n, true);
    v.setUint8(ptr + 16, node.kind);
    v.setBigUint64(ptr + 24, 1n, true);
    v.setBigUint64(ptr + 32, BigInt(node.kind === FILE ? node.bytes.length : 0), true);
  };
  const iovs = (ptr, n) => Array.from({ length: n }, (_, i) => [view().getUint32(ptr + 8 * i, true), view().getUint32(ptr + 8 * i + 4, true)]);
  const rofs = () => E.ROFS;
  const wasi = {
    args_sizes_get(c, s) { view().setUint32(c, argv.length, true); view().setUint32(s, argv.reduce((a, b) => a + b.length, 0), true); return 0; },
    args_get(p, b) { for (const a of argv) { view().setUint32(p, b, true); bytes().set(a, b); p += 4; b += a.length; } return 0; },
    environ_sizes_get(c, s) { view().setUint32(c, envv.length, true); view().setUint32(s, envv.reduce((a, b) => a + b.length, 0), true); return 0; },
    environ_get(p, b) { for (const a of envv) { view().setUint32(p, b, true); bytes().set(a, b); p += 4; b += a.length; } return 0; },
    clock_time_get(id, precision, ptr) { view().setBigUint64(ptr, BigInt(Math.round(performance.timeOrigin + performance.now())) * 1000000n, true); return 0; },
    random_get(ptr, len) { crypto.getRandomValues(bytes().subarray(ptr, ptr + len)); return 0; },
    sched_yield() { return 0; },
    proc_exit(code) { throw new Exit(code); },
    fd_prestat_get(fd, ptr) { const f = fds.get(fd); if (!f?.preopen) return E.BADF; view().setUint8(ptr, 0); view().setUint32(ptr + 4, enc.encode(f.preopen).length, true); return 0; },
    fd_prestat_dir_name(fd, ptr, len) { const f = fds.get(fd); if (!f?.preopen) return E.BADF; bytes().set(enc.encode(f.preopen).subarray(0, len), ptr); return 0; },
    fd_fdstat_get(fd, ptr) {
      const f = fds.get(fd); if (!f) return E.BADF;
      const v = view(); v.setUint8(ptr, f.node ? f.node.kind : CHAR); v.setUint16(ptr + 2, 0, true);
      v.setBigUint64(ptr + 8, 0xffffffffn, true); v.setBigUint64(ptr + 16, 0xffffffffn, true); return 0;
    },
    fd_filestat_get(fd, ptr) { const f = fds.get(fd); if (!f) return E.BADF; filestat(ptr, f.node ?? { kind: CHAR }); return 0; },
    fd_close(fd) { if (!fds.has(fd) || fd < 3) return fd < 3 ? 0 : E.BADF; fds.delete(fd); return 0; },
    fd_sync() { return 0; },
    fd_read(fd, iov, n, nread) {
      const f = fds.get(fd); if (!f) return E.BADF;
      if (f.stdin) { view().setUint32(nread, 0, true); return 0; }
      if (!f.node || f.node.kind !== FILE) return E.ISDIR;
      let total = 0;
      for (const [buf, len] of iovs(iov, n)) {
        const chunk = f.node.bytes.subarray(f.pos, f.pos + len);
        bytes().set(chunk, buf); f.pos += chunk.length; total += chunk.length;
        if (chunk.length < len) break;
      }
      view().setUint32(nread, total, true); return 0;
    },
    fd_write(fd, iov, n, nwritten) {
      if (fd !== 1 && fd !== 2) return fds.has(fd) ? E.ROFS : E.BADF;
      let total = 0;
      for (const [buf, len] of iovs(iov, n)) { out[fd].push(bytes().slice(buf, buf + len)); total += len; }
      view().setUint32(nwritten, total, true); return 0;
    },
    fd_readdir(fd, buf, len, cookie, used) {
      const f = fds.get(fd); if (!f?.node || f.node.kind !== DIR) return E.NOTDIR;
      const names = [...f.node.entries.keys()].sort();
      let off = 0;
      for (let i = Number(cookie); i < names.length; i++) {
        const name = enc.encode(names[i]), node = f.node.entries.get(names[i]);
        const head = new Uint8Array(24), hv = new DataView(head.buffer);
        hv.setBigUint64(0, BigInt(i + 1), true); hv.setBigUint64(8, node.ino, true);
        hv.setUint32(16, name.length, true); hv.setUint8(20, node.kind);
        const entry = new Uint8Array(24 + name.length); entry.set(head); entry.set(name, 24);
        const take = Math.min(entry.length, len - off);
        bytes().set(entry.subarray(0, take), buf + off); off += take;
        if (take < entry.length) break;
      }
      view().setUint32(used, off, true); return 0;
    },
    path_filestat_get(fd, flags, p, l, ptr) { const [e, node] = lookup(fd, str(p, l)); if (e) return e; filestat(ptr, node); return 0; },
    path_open(fd, dirflags, p, l, oflags, rightsBase, rightsInh, fdflags, out) {
      if (oflags & (OFLAGS_CREAT | OFLAGS_TRUNC)) return E.ROFS;
      const [e, node] = lookup(fd, str(p, l)); if (e) return e;
      if ((oflags & OFLAGS_DIRECTORY) && node.kind !== DIR) return E.NOTDIR;
      const n = next++; fds.set(n, { node, pos: 0 }); view().setUint32(out, n, true); return 0;
    },
    path_readlink() { return E.INVAL; },
    path_create_directory: rofs, path_link: rofs, path_remove_directory: rofs, path_rename: rofs, path_unlink_file: rofs,
  };
  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi });
  memory = instance.exports.memory;
  let exit = 0;
  try { instance.exports._start(); } catch (e) { if (e instanceof Exit) exit = e.code; else throw e; }
  const join = (chunks) => { const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; } return dec.decode(all); };
  return { exit, stdout: join(out[1]), stderr: join(out[2]) };
}
