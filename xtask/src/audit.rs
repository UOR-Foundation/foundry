//! The grep-shaped gates.
//!
//! These are crude on purpose. A gate that needs interpretation is a gate that
//! gets argued with; these ones read the source, find a token, and fail. Each
//! carries the rule it enforces in its failure message, because the point of a
//! red gate is to name the promise that was broken.

use std::path::{Path, PathBuf};

use crate::Fail;

/// The crates that ship: every crate under `crates/` that is not
/// `publish = false`. The rules below apply to those and not to the
/// dev-and-CI-only crates, which may use `std`, `alloc`, and floats freely.
///
/// Derived from the manifests rather than listed here. A list would be a second
/// place to remember, and the failure mode of a second place is that a crate
/// added to one is missing from the other --- silently, because a gate that
/// skips a crate cannot report on it. Reading `publish = false` asks the same
/// question `cargo publish` asks.
fn shipped(root: &Path) -> Result<Vec<String>, Fail> {
    let mut out = Vec::new();
    let dir = root.join("crates");
    if !dir.exists() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(&dir)? {
        let path = entry?.path();
        let manifest = path.join("Cargo.toml");
        let Ok(toml) = std::fs::read_to_string(&manifest) else {
            continue;
        };
        if toml.lines().any(|l| l.trim() == "publish = false") {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            out.push(name.to_string());
        }
    }
    out.sort();
    Ok(out)
}

struct Source {
    rel: String,
    text: String,
}

fn shipped_sources(root: &Path) -> Result<Vec<Source>, Fail> {
    let mut out = Vec::new();
    for name in shipped(root)? {
        let dir = root.join("crates").join(&name).join("src");
        if !dir.exists() {
            continue;
        }
        collect(&dir, root, &mut out)?;
    }
    Ok(out)
}

fn collect(dir: &Path, root: &Path, out: &mut Vec<Source>) -> Result<(), Fail> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            collect(&path, root, out)?;
        } else if path.extension().is_some_and(|e| e == "rs") {
            let text = std::fs::read_to_string(&path)?;
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .display()
                .to_string();
            out.push(Source { rel, text });
        }
    }
    Ok(())
}

/// Lines of `text` outside comments and outside `#[cfg(test)]` modules.
///
/// A rule about what the code *does* must not be tripped by a doc comment
/// explaining what it does not do, nor by a test that deliberately constructs
/// the forbidden thing to prove it is caught.
fn effective_lines(text: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut in_test = false;
    let mut test_depth = 0i32;
    let mut depth = 0i32;
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.starts_with("//") || line.starts_with("#!") {
            // A `#![deny(...)]` or a comment states policy; it never is the
            // behaviour the gate is looking for.
            continue;
        }
        let opens = raw.matches('{').count() as i32;
        let closes = raw.matches('}').count() as i32;
        if line.starts_with("#[cfg(test)]") {
            in_test = true;
            test_depth = depth;
        }
        if !in_test {
            let code = line.split("//").next().unwrap_or("");
            if !code.trim().is_empty() {
                out.push((i + 1, code));
            }
        }
        depth += opens - closes;
        if in_test && depth <= test_depth && closes > 0 {
            in_test = false;
        }
    }
    out
}

/// R5: no arbitrary limitation. Every bound is a property of the caller's
/// chosen instantiation, never of the code.
///
/// Concretely: no shipped crate may return an error the model does not
/// sanction. The absence of a class of error is checked here --- the absence of
/// negative testing is only honest if there is nothing to test negatively.
pub fn audit_limits(root: &Path) -> Result<(), Fail> {
    let sources = shipped_sources(root)?;
    // The only error type a shipped crate may name, plus the declaration check at
    // a declared boundary, which is not the operation failing.
    let sanctioned = ["NotAProduct", "ObservedBound", "KappaError"];

    let mut violations = Vec::new();
    for src in &sources {
        for (line_no, line) in effective_lines(&src.text) {
            let Some(pos) = line.find("Result<") else {
                continue;
            };
            let tail = &line[pos..];
            if sanctioned.iter().any(|s| tail.contains(s)) {
                continue;
            }
            violations.push(format!("{}:{line_no}:{}", src.rel, line.trim()));
        }
    }
    if !violations.is_empty() {
        return Err(format!(
            "R5: every bound is derived from declared parameters and is a \
             property of the caller's chosen instantiation. The only reportable \
             condition is that the requested object does not exist, reported at view \
             construction. A `Result` over anything else is a limitation the model does \
             not sanction.\n\n{}",
            violations.join("\n")
        )
        .into());
    }
    println!("audit-limits: no shipped crate returns an unsanctioned error (R5)");
    Ok(())
}

/// R4: nothing is deferred. No deferral marker, no stub, no placeholder
/// document section, no capability behind a flag that turns it off.
///
/// The markers are spelled in halves. This gate reads every crate *and*
/// `xtask`, which means it reads this file, and a list of forbidden tokens
/// written out in full is a list that matches itself --- the gate would fail on
/// its own definition, for ever. The alternative is exempting this file, and an
/// exemption is a hole: a real deferral parked in the gate would then be the one
/// place nothing looks. Split, the gate scans itself like anything else.
pub fn audit_deferral(root: &Path) -> Result<(), Fail> {
    let markers = [
        concat!("TO", "DO"),
        concat!("FIX", "ME"),
        concat!("XX", "X"),
        concat!("unimplemented", "!"),
        concat!("to", "do!"),
        concat!("for ", "now"),
        concat!("later ", "version"),
    ];
    let mut violations = Vec::new();

    // Every crate, not only the shipped ones, and `xtask` with them: R4 is a
    // promise about the repository, and a deferral parked in a gate is the same
    // deferral as one parked in shipped code.
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in [root.join("crates"), root.join("xtask")] {
        if dir.exists() {
            gather_all(&dir, &mut files)?;
        }
    }
    // Every Markdown file at the root, discovered rather than listed. A list
    // here would go stale the first time a document was added or renamed, and
    // the failure would be silent: a document nobody scans reports nothing.
    for entry in std::fs::read_dir(root)? {
        let p = entry?.path();
        if p.extension().is_some_and(|e| e == "md") {
            files.push(p);
        }
    }

    for path in files {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .display()
            .to_string();
        for (i, line) in text.lines().enumerate() {
            for marker in markers {
                if !line.contains(marker) {
                    continue;
                }
                // A backticked marker is a *mention*, not a use: the
                // documentation has to be able to name what the gate catches
                // without tripping it. Anything outside code spans is real.
                if outside_code_spans(line, marker) {
                    violations.push(format!("{rel}:{}: {}", i + 1, line.trim()));
                }
            }
        }
    }

    if !violations.is_empty() {
        return Err(format!(
            "R4: nothing is deferred. None of {} may appear, and no stub, no \
             placeholder section, and no capability behind a flag that turns it \
             off. Every capability ships in the one release.\n\n{}",
            markers.join(", "),
            violations.join("\n")
        )
        .into());
    }
    println!("audit-deferral: nothing is deferred (R4)");
    Ok(())
}

/// Does `marker` occur in `line` outside every backtick-delimited span?
fn outside_code_spans(line: &str, marker: &str) -> bool {
    let mut rest = line;
    let mut at = 0usize;
    while let Some(pos) = rest.find(marker) {
        let absolute = at + pos;
        // An odd number of backticks before this occurrence means it is inside
        // a span.
        if line[..absolute].matches('`').count().is_multiple_of(2) {
            return true;
        }
        at = absolute + marker.len();
        rest = &line[at..];
    }
    false
}

fn gather_all(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), Fail> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|n| n == "target") {
                continue;
            }
            gather_all(&path, out)?;
        } else if path
            .extension()
            .is_some_and(|e| e == "rs" || e == "md" || e == "toml")
        {
            out.push(path);
        }
    }
    Ok(())
}

/// Only Prism is implemented here.
///
/// Foundry is a Prism model: behavior is written in LexLean (`*.lex.tex`), checked by Lean and
/// built by PrismPM. Everything else that executes, hand-written Rust, TypeScript, JavaScript,
/// Python, shell, CSS or HTML, is non-Prism implementation, and it may only shrink. This is the
/// shrink-only ratchet of `afflom/rule30` (Python may not grow) and `afflom/verdant-resonance`
/// (hand-written modules may not grow), applied to every non-Prism language at once.
///
/// The ceiling is the commit's first parent, measured, not a recorded number: on a pull request
/// or merge queue run the checked-out commit is a merge whose first parent is the base branch,
/// and on main it is the previous main. So a removal tightens the ceiling the moment it merges,
/// with no baseline file to regenerate, and a ceiling cannot be raised by editing one.
///
/// Refused: a non-Prism file the parent does not have (author it in LexLean instead), and any
/// net growth in non-Prism lines. Lines are non-blank and outside comments, so explaining a
/// decision costs nothing. Prism output that a Prism lock binds byte for byte is Prism's own
/// and is not counted: the frame `frame.lock` pins to the template, and the Prism id
/// `identity/stitch.lock` generates from stitch's model. A bound file whose bytes differ from its
/// lock is counted.
pub mod prism {
    use std::collections::BTreeMap;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::path::Path;
    use std::process::{Command, Stdio};

    use sha2::{Digest, Sha256};

    use crate::Fail;

    /// Non-Prism implementation, by extension, with the comment syntax its lines are counted under.
    const LANGUAGES: [(&str, Comments); 20] = [
        ("rs", Comments::C),
        ("ts", Comments::C),
        ("tsx", Comments::C),
        ("mts", Comments::C),
        ("cts", Comments::C),
        ("js", Comments::C),
        ("mjs", Comments::C),
        ("cjs", Comments::C),
        ("jsx", Comments::C),
        ("css", Comments::C),
        ("scss", Comments::C),
        ("c", Comments::C),
        ("h", Comments::C),
        ("cpp", Comments::C),
        ("html", Comments::Html),
        ("py", Comments::Hash),
        ("sh", Comments::Hash),
        ("bash", Comments::Hash),
        ("awk", Comments::Hash),
        ("lean", Comments::Lean),
    ];

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    enum Comments {
        /// `//` lines and `/* */` blocks.
        C,
        /// `#` lines.
        Hash,
        /// `--` lines and `/- -/` blocks.
        Lean,
        /// `<!-- -->` blocks.
        Html,
    }

    fn language(path: &str) -> Option<Comments> {
        let name = path.rsplit('/').next().unwrap_or(path);
        let (_, extension) = name.rsplit_once('.')?;
        LANGUAGES
            .iter()
            .find(|(e, _)| *e == extension)
            .map(|(_, c)| *c)
    }

    /// Non-blank lines outside comments. A line that starts inside a block comment and ends it
    /// counts only if code follows the close.
    fn count_lines(text: &str, comments: Comments) -> usize {
        let (line, open, close) = match comments {
            Comments::C => (Some("//"), Some("/*"), Some("*/")),
            Comments::Hash => (Some("#"), None, None),
            Comments::Lean => (Some("--"), Some("/-"), Some("-/")),
            Comments::Html => (None, Some("<!--"), Some("-->")),
        };
        let mut in_block = false;
        let mut count = 0;
        for raw in text.lines() {
            let mut rest = raw.trim();
            if in_block {
                match close.and_then(|c| rest.find(c).map(|i| i + c.len())) {
                    Some(end) => {
                        in_block = false;
                        rest = rest[end..].trim();
                    }
                    None => continue,
                }
            }
            while let (Some(o), Some(c)) = (open, close) {
                let Some(after) = rest.strip_prefix(o) else {
                    break;
                };
                match after.find(c) {
                    Some(end) => rest = after[end + c.len()..].trim(),
                    None => {
                        in_block = true;
                        rest = "";
                    }
                }
            }
            if rest.is_empty() || line.is_some_and(|l| rest.starts_with(l)) {
                continue;
            }
            count += 1;
        }
        count
    }

    /// The locks that bind Prism output: each `files` entry and the `output` entry name a path
    /// and the digest its bytes must have.
    const PRISM_LOCKS: [&str; 2] = ["frame.lock", "identity/stitch.lock"];

    /// Paths the Prism locks bind, with the digest each must have. `read` answers a lock's text,
    /// or `None` where the tree has no such lock.
    fn bound(
        mut read: impl FnMut(&str) -> Result<Option<String>, Fail>,
    ) -> Result<BTreeMap<String, String>, Fail> {
        let mut out = BTreeMap::new();
        for name in PRISM_LOCKS {
            let Some(text) = read(name)? else {
                continue;
            };
            let lock: serde_json::Value = serde_json::from_str(&text)?;
            let files = lock["files"].as_array().into_iter().flatten();
            for entry in files.chain(lock.get("output")) {
                let (Some(path), Some(sha256)) = (entry["path"].as_str(), entry["sha256"].as_str())
                else {
                    return Err(format!("{name}: an entry without a path and a sha256").into());
                };
                out.insert(path.to_string(), sha256.to_string());
            }
        }
        Ok(out)
    }

    /// Non-Prism lines per file of one tree.
    #[derive(Default, Debug)]
    struct Measure {
        files: BTreeMap<String, usize>,
    }

    impl Measure {
        fn total(&self) -> usize {
            self.files.values().sum()
        }

        /// Adds `path` if it is non-Prism implementation.
        fn add(&mut self, path: &str, bytes: &[u8], frame: &BTreeMap<String, String>) {
            let Some(comments) = language(path) else {
                return;
            };
            if frame
                .get(path)
                .is_some_and(|sha256| *sha256 == hex(&Sha256::digest(bytes)))
            {
                return;
            }
            let lines = count_lines(&String::from_utf8_lossy(bytes), comments);
            self.files.insert(path.to_string(), lines);
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// The ratchet itself: what `current` adds over `ceiling`, or nothing.
    fn refusals(ceiling: &Measure, current: &Measure) -> Vec<String> {
        let mut out = Vec::new();
        let added: Vec<&String> = current
            .files
            .keys()
            .filter(|path| !ceiling.files.contains_key(*path))
            .collect();
        if !added.is_empty() {
            let shown: Vec<&str> = added.iter().take(20).map(|p| p.as_str()).collect();
            out.push(format!(
                "{} new non-Prism file(s): {}{}. Author the behavior in LexLean (`*.lex.tex`) so PrismPM builds it.",
                added.len(),
                shown.join(", "),
                if added.len() > shown.len() { ", ..." } else { "" }
            ));
        }
        let (now, before) = (current.total(), ceiling.total());
        if now > before {
            let mut grown: Vec<(&String, usize)> = current
                .files
                .iter()
                .filter_map(|(path, &n)| {
                    let was = ceiling.files.get(path).copied().unwrap_or(0);
                    n.checked_sub(was).filter(|d| *d > 0).map(|d| (path, d))
                })
                .collect();
            grown.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
            let shown: Vec<String> = grown
                .iter()
                .take(10)
                .map(|(p, n)| format!("{p} +{n}"))
                .collect();
            out.push(format!(
                "non-Prism implementation grew by {} lines ({before} to {now}); grown: {}. It may only shrink: move the logic into the Prism model, or delete as much as you add.",
                now - before,
                shown.join(", ")
            ));
        }
        out
    }

    fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>, Fail> {
        let out = Command::new("git").current_dir(root).args(args).output()?;
        if !out.status.success() {
            return Err(format!(
                "git {}: {}",
                args.join(" "),
                String::from_utf8_lossy(&out.stderr).trim()
            )
            .into());
        }
        Ok(out.stdout)
    }

    /// The working tree's tracked files.
    fn measure_worktree(root: &Path) -> Result<Measure, Fail> {
        let frame = bound(|name| match std::fs::read_to_string(root.join(name)) {
            Ok(text) => Ok(Some(text)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        })?;
        let mut measure = Measure::default();
        for path in git(root, &["ls-files", "-z", "--cached"])?.split(|b| *b == 0) {
            let path = std::str::from_utf8(path)?;
            if path.is_empty() || language(path).is_none() {
                continue;
            }
            let full = root.join(path);
            // A symlink is not implementation of its own, and a path deleted but not yet staged is
            // gone.
            if full.is_symlink() || !full.is_file() {
                continue;
            }
            measure.add(path, &std::fs::read(&full)?, &frame);
        }
        Ok(measure)
    }

    /// A commit's tree, read from the object store.
    fn measure_commit(root: &Path, commit: &str) -> Result<Measure, Fail> {
        let frame = bound(
            |name| match git(root, &["show", &format!("{commit}:{name}")]) {
                Ok(text) => Ok(Some(String::from_utf8(text)?)),
                Err(_) => Ok(None),
            },
        )?;
        let listing = git(root, &["ls-tree", "-r", "-z", commit])?;
        let mut blobs = Vec::new();
        for entry in listing.split(|b| *b == 0) {
            let entry = std::str::from_utf8(entry)?;
            let Some((meta, path)) = entry.split_once('\t') else {
                continue;
            };
            let fields: Vec<&str> = meta.split(' ').collect();
            if fields.len() == 3
                && fields[0] != "120000"
                && fields[1] == "blob"
                && language(path).is_some()
            {
                blobs.push((fields[2].to_string(), path.to_string()));
            }
        }

        let mut child = Command::new("git")
            .current_dir(root)
            .args(["cat-file", "--batch"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        let mut stdin = child.stdin.take().ok_or("git cat-file: no stdin")?;
        let ids: Vec<String> = blobs.iter().map(|(id, _)| id.clone()).collect();
        // Written from a thread so that a full output pipe cannot stall the request.
        let writer = std::thread::spawn(move || -> std::io::Result<()> {
            for id in ids {
                writeln!(stdin, "{id}")?;
            }
            Ok(())
        });
        let mut reader = BufReader::new(child.stdout.take().ok_or("git cat-file: no stdout")?);
        let mut measure = Measure::default();
        for (_, path) in &blobs {
            let mut header = String::new();
            reader.read_line(&mut header)?;
            let size: usize = header
                .split(' ')
                .nth(2)
                .and_then(|s| s.trim().parse().ok())
                .ok_or_else(|| format!("git cat-file: unexpected header {header:?} for {path}"))?;
            let mut bytes = vec![0; size + 1];
            reader.read_exact(&mut bytes)?;
            bytes.truncate(size);
            measure.add(path, &bytes, &frame);
        }
        writer
            .join()
            .map_err(|_| "git cat-file: writer panicked")??;
        child.wait()?;
        Ok(measure)
    }

    pub fn audit(root: &Path) -> Result<(), Fail> {
        let current = measure_worktree(root)?;
        let parent = git(root, &["rev-parse", "--verify", "-q", "HEAD^1^{commit}"]);
        let Ok(parent) = parent else {
            // A shallow clone hides the parent rather than lacking one: that is a gate that cannot
            // see its ceiling, and it must not pass.
            if git(root, &["rev-parse", "--is-shallow-repository"])?.starts_with(b"true") {
                return Err("audit-prism: the clone is shallow, so the parent commit, the ratchet's ceiling, cannot be read; check out with full history".into());
            }
            println!(
                "audit-prism: a root commit; non-Prism implementation is {} lines in {} files",
                current.total(),
                current.files.len()
            );
            return Ok(());
        };
        let parent = String::from_utf8(parent)?.trim().to_string();
        let ceiling = measure_commit(root, &parent)?;
        let refused = refusals(&ceiling, &current);
        if !refused.is_empty() {
            return Err(format!(
                "audit-prism: only Prism may be implemented here, measured against {}:\n  - {}",
                &parent[..12.min(parent.len())],
                refused.join("\n  - ")
            )
            .into());
        }
        println!(
            "audit-prism: non-Prism implementation is {} lines in {} files ({} lines, {} files in the parent); it only shrinks",
            current.total(),
            current.files.len(),
            ceiling.total(),
            ceiling.files.len()
        );
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn measure(files: &[(&str, &str)]) -> Measure {
            let mut m = Measure::default();
            for (path, text) in files {
                m.add(path, text.as_bytes(), &BTreeMap::new());
            }
            m
        }

        #[test]
        fn counts_code_not_comments_or_blank_lines() {
            let rust = "// why\n/* a\n block */\nfn a() {}\n\n/* x */ let b = 1;\n";
            assert_eq!(count_lines(rust, Comments::C), 2);
            assert_eq!(
                count_lines("#!/bin/sh\n# why\necho hi\n", Comments::Hash),
                1
            );
            assert_eq!(
                count_lines("/- doc\n-/\n-- x\ndef a := 1\n", Comments::Lean),
                1
            );
            assert_eq!(count_lines("<!--\n x -->\n<p>a</p>\n", Comments::Html), 1);
        }

        #[test]
        fn prism_and_data_are_not_counted() {
            let m = measure(&[
                ("app/src/Kernel.lex.tex", "def a := 1\n"),
                ("model/ids.toml", "x = 1\n"),
                ("app/product.json", "{}\n"),
                ("studio/a.mjs", "export {}\n"),
            ]);
            assert_eq!(m.files.keys().collect::<Vec<_>>(), ["studio/a.mjs"]);
        }

        #[test]
        fn locks_bind_frame_files_and_generated_output() {
            let frame = r#"{"files": [{"path": "site/app.mjs", "sha256": "aa"}]}"#;
            let stitch = r#"{"output": {"path": "identity/prism-id.mjs", "sha256": "bb"}}"#;
            let locks = bound(|name| {
                Ok(match name {
                    "frame.lock" => Some(frame.to_string()),
                    "identity/stitch.lock" => Some(stitch.to_string()),
                    _ => None,
                })
            })
            .unwrap();
            assert_eq!(locks.get("site/app.mjs").map(String::as_str), Some("aa"));
            assert_eq!(
                locks.get("identity/prism-id.mjs").map(String::as_str),
                Some("bb")
            );
            assert!(bound(|_| Ok(Some(r#"{"files": [{"path": "x"}]}"#.to_string()))).is_err());
        }

        #[test]
        fn frame_counts_only_while_its_bytes_match_the_lock() {
            let bytes = b"export const a = 1;\n";
            let lock = BTreeMap::from([("site/app.mjs".to_string(), hex(&Sha256::digest(bytes)))]);
            let mut m = Measure::default();
            m.add("site/app.mjs", bytes, &lock);
            assert!(m.files.is_empty());
            m.add("site/app.mjs", b"export const a = 2;\nlet b;\n", &lock);
            assert_eq!(m.total(), 2);
        }

        // The planted defects: each must be refused.
        #[test]
        fn refuses_a_new_non_prism_file() {
            let before = measure(&[("studio/a.mjs", "a()\nb()\n")]);
            let after = measure(&[("studio/a.mjs", "a()\n"), ("studio/b.ts", "b()\n")]);
            let refused = refusals(&before, &after);
            assert_eq!(refused.len(), 1);
            assert!(refused[0].contains("studio/b.ts"));
        }

        #[test]
        fn refuses_net_growth() {
            let before = measure(&[("studio/a.mjs", "a()\n"), ("crates/x.rs", "x();\n")]);
            let after = measure(&[("studio/a.mjs", "a()\nb()\nc()\n")]);
            let refused = refusals(&before, &after);
            assert_eq!(refused.len(), 1);
            assert!(
                refused[0].contains("grew by 1 lines (2 to 3)"),
                "{refused:?}"
            );
            assert!(refused[0].contains("studio/a.mjs +2"));
        }

        #[test]
        fn names_what_grew_when_another_file_shrank() {
            let before = measure(&[("studio/a.mjs", "a()\nb()\n"), ("studio/c.mjs", "c()\n")]);
            let after = measure(&[
                ("studio/a.mjs", "a()\n"),
                ("studio/c.mjs", "c()\nd()\ne()\nf()\n"),
            ]);
            let refused = refusals(&before, &after);
            assert_eq!(refused.len(), 1);
            assert!(refused[0].contains("studio/c.mjs +3"), "{refused:?}");
            assert!(!refused[0].contains("studio/a.mjs"), "{refused:?}");
        }

        #[test]
        fn admits_shrinking_and_growth_paid_for_by_deletion() {
            let before = measure(&[("studio/a.mjs", "a()\nb()\n"), ("studio/c.mjs", "c()\n")]);
            let after = measure(&[("studio/a.mjs", "a()\nb()\nd()\n")]);
            assert!(refusals(&before, &after).is_empty());
            assert!(refusals(&before, &measure(&[])).is_empty());
        }

        #[test]
        fn a_comment_or_a_blank_line_is_free() {
            let before = measure(&[("studio/a.mjs", "a()\n")]);
            let after = measure(&[("studio/a.mjs", "// why a\n\na()\n")]);
            assert!(refusals(&before, &after).is_empty());
        }
    }
}
