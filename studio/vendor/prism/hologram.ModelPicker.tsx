// prism-prism (ours, not Prism's; see VENDORED.md): the model picker, replacing Prism's at build time
// through `resolveId` in vite.shell.config.mts. Two models answer here (shell/host.js): GLM 5.3 Flash in the
// cloud (Featherless) and BitNet 2B on this device. The menu is those two, each with one word saying where
// it runs, and nothing else: no provider headers, no submenus, no recent section, no effort levels, no price
// badges, no trial banner, no Pro upsell. Choosing a model is choosing who answers, which is the only
// decision this control makes.
//
// It writes what Prism's own picker writes, so every screen stays in sync: the settings record's
// selectedModel, and the chat's own selection once that chat has a history (the host's chat turn
// prefers the chat's).
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatMode } from "@/hooks/useChatMode";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { useSettings } from "@/hooks/useSettings";
import { createModelSelection } from "@/lib/modelEffort";
import type { LanguageModel } from "@/ipc/types";
import type { LargeLanguageModel } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const ORDER = ["featherless", "local"];
// Where each provider's model runs, in one word, shown as a quiet pill beside the name.
const WHERE: Record<string, string> = { featherless: "Cloud", local: "Local" };
const Pill = ({ where }: { where: string }) => (
  <span className="shrink-0 rounded-full border border-border/50 px-1.5 py-px text-[10px] font-normal leading-4 text-muted-foreground/70">{where}</span>
);

export function ModelPicker() {
  const { settings, updateSettings } = useSettings();
  const routerState = useRouterState();
  const isChatRoute = routerState.location.pathname === "/chat";
  const chatId = routerState.location.search.id as number | undefined;
  const { chat, setChatSelection } = useChatMode(isChatRoute ? chatId : null);
  const { data: providers } = useLanguageModelProviders();
  const { data: modelsByProvider, isLoading } = useLanguageModelsByProviders();
  const [open, setOpen] = useState(false);

  const listed = (providers ?? [])
    .filter((provider) => ORDER.includes(provider.id))
    .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const selected: LargeLanguageModel =
    chat?.modelSelection ?? settings?.selectedModel ?? { name: "", provider: "local" };
  const modelsOf = (providerId: string) => modelsByProvider?.[providerId] ?? [];
  const isSelected = (providerId: string, model: LanguageModel) =>
    // The product's default is the device, so a selection Prism left as "auto" reads as the device's model.
    (selected.provider === providerId || (selected.provider === "auto" && providerId === "local")) &&
    (selected.name === model.apiName || selected.provider === "auto");

  const options = listed.flatMap((provider) => modelsOf(provider.id).map((model) => ({ provider: provider.id, model })));
  // A selection no longer offered (OpenRouter) answers on the device, so it reads as the device's model.
  const current =
    options.find(({ provider, model }) => isSelected(provider, model)) ?? options.find(({ provider }) => provider === "local");
  const label = current ? current.model.displayName : selected.name;
  const where = current ? WHERE[current.provider] : "";

  const choose = async (providerId: string, model: LanguageModel) => {
    const next: LargeLanguageModel = { name: model.apiName, provider: providerId };
    if (chat && (chat.modelSelection || chat.messages.length > 0)) {
      await setChatSelection({ modelSelection: createModelSelection({ model: next, catalogModel: model }) });
    }
    await updateSettings({ selectedModel: next });
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="inline-flex h-8 max-w-[240px] cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-border/70 bg-background/40 pl-3 pr-2 text-xs font-medium text-foreground/90 shadow-none transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted/60"
        data-testid="model-picker"
        title={where ? `${label}, ${where}` : label}
      >
        <span className="truncate">{label}</span>
        {where && <Pill where={where} />}
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="start">
        {isLoading && <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading models</div>}
        {options.map(({ provider, model }) => (
          <DropdownMenuItem
            key={provider + ":" + model.apiName}
            onClick={() => choose(provider, model)}
            className={cn("cursor-pointer gap-2", isSelected(provider, model) && "bg-accent")}
          >
            <span className="min-w-0 flex-1 truncate">{model.displayName}</span>
            <Pill where={WHERE[provider]} />
            {isSelected(provider, model) && <CheckIcon className="size-3.5 shrink-0 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
