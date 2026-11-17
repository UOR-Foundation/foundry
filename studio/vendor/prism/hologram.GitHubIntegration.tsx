// prism-prism (ours, not Prism's; see VENDORED.md): Settings → Integrations → GitHub, replacing Prism's at build
// time through `resolveId` in vite.shell.config.mts. Publishing builds an app with the Prism SDK on GitHub
// Actions, in a repository made from UOR-Foundation/template under the visitor's account (shell/host.js).
// Prism connects GitHub with the device flow, which GitHub serves to apps and not to web pages, so here the
// visitor pastes a token. It is checked against GitHub once, kept in this browser's settings like a model key,
// and sent only to api.github.com.
import { useState } from "react";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/hooks/useSettings";

const NEW_TOKEN =
  "https://github.com/settings/personal-access-tokens/new?name=Prism%20AI%20Foundry&description=Builds%20Prism%20apps%20on%20GitHub%20Actions";

export function GitHubIntegration() {
  const { settings, updateSettings } = useSettings();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = settings?.githubAccessToken?.value ? settings.githubUser?.email || "GitHub" : null;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(r.status === 401 ? "GitHub did not accept this token." : `GitHub answered ${r.status}.`);
      const user = await r.json();
      await updateSettings({ githubAccessToken: { value: token.trim() }, githubUser: { email: user.login } });
      setToken("");
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (connected) {
    return (
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">GitHub</h3>
          <p className="mt-1 text-xs text-muted-foreground">Connected as {connected}. Publishing builds apps with the Prism SDK in your account.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => updateSettings({ githubAccessToken: undefined, githubUser: undefined })}>
          Disconnect <Github className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">GitHub</h3>
      <p className="text-xs text-muted-foreground">
        Publishing builds each app with the Prism SDK on GitHub Actions, in a new public repository in your account.{" "}
        <a className="underline" href={NEW_TOKEN} target="_blank" rel="noreferrer">Create a token</a> with access to all repositories and
        Administration, Contents and Pages set to read and write, Actions to read. It stays in this browser.
      </p>
      <div className="flex gap-2">
        <Input type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
        <Button size="sm" disabled={!token.trim() || busy} onClick={connect}>{busy ? "Checking" : "Connect"}</Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
