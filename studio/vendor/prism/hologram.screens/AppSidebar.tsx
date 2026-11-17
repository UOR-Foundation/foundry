// hologram-forge (ours, not Prism's; see VENDORED.md): the shell's sidebar and site header, in place of
// src/components/app-sidebar.tsx (hologram.screens.mjs; it is compiled at that path, so its imports
// resolve as Prism's did). The structure is shadcn's dashboard-01 block: an
// inset sidebar that collapses to icons, a primary action, the main navigation, the user's apps, and
// Settings and Help at the foot. Every part is the kit's shadcn/ui component; Prism's hooks and atoms
// supply the data and the navigation, so the screens behind it are unchanged.
import {
  BookOpen,
  Blocks,
  CirclePlus,
  HelpCircle,
  House,
  LayoutGrid,
  Settings,
  Star,
  Store,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation, useMatchRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { Fragment, useEffect, useMemo } from "react";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { helpDialogAtom } from "@/atoms/helpDialogAtom";
import { HelpDialog } from "@/components/HelpDialog";
import { useChats } from "@/hooks/useChats";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useOpenApp } from "@/hooks/useOpenApp";
import { useSelectChat } from "@/hooks/useSelectChat";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

// The product's name: the build's word transform (vite.shell.config.mts) writes the product's name for
// Prism's, here as on every Prism screen, so the name has one source.
const PRODUCT = "Prism";
const TITLE = `${PRODUCT} AI Foundry`;

// Prism's mark: a triangle split into three lit faces. It is drawn in the text colour at three
// strengths, so it follows every appearance without a colour of its own.
function PrismMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className} fill="currentColor">
      <path d="M50 8 L50 60 L8 86 Z" />
      <path d="M50 8 L92 86 L50 60 Z" fillOpacity={0.6} />
      <path d="M8 86 L50 60 L92 86 Z" fillOpacity={0.3} />
    </svg>
  );
}

type Nav = { title: string; to: string; icon: LucideIcon; exact?: boolean };
const NAV: Nav[] = [
  { title: "Home", to: "/", icon: House, exact: true },
  { title: "Apps", to: "/apps", icon: LayoutGrid },
  { title: "Templates", to: "/templates", icon: Store },
  { title: "Library", to: "/library", icon: BookOpen },
  { title: "Plugins", to: "/plugins", icon: Blocks },
];
const RECENT_APPS = 8;
const RECENT_CHATS = 6;

// The path inside the base the shell is served under.
function usePath() {
  const router = useRouter();
  const pathname = useLocation({ select: (l) => l.pathname });
  const base = (router.options.basepath ?? "").replace(/\/$/, "");
  return (pathname.startsWith(base) ? pathname.slice(base.length) : pathname) || "/";
}

// Matched by the router; the home page only on its own path (the router also matches it under the app's
// routes, which are its children).
function useIsActive() {
  const matchRoute = useMatchRoute();
  const path = usePath();
  return (to: string, exact?: boolean) => (to === "/" ? path === "/" : !!matchRoute({ to, fuzzy: !exact }));
}

export function AppSidebar() {
  const isActive = useIsActive();
  // On a phone the sidebar is the kit's Sheet over the page: a choice in it (a link, an app, a chat) closes
  // it, so the page the visitor asked for is what they see.
  const { isMobile, setOpenMobile } = useSidebar();
  const href = useLocation({ select: (l) => l.href });
  useEffect(() => { if (isMobile) setOpenMobile(false); }, [href, isMobile, setOpenMobile]);
  // A tooltip names an item of the collapsed rail. In the Sheet it is never shown, but the kit still opens it
  // when the Sheet focuses its first item, and the first Escape then closed that invisible tooltip, not the
  // Sheet. On a phone the items carry none.
  const tip = (label: string) => (isMobile ? undefined : label);
  const navigate = useNavigate();
  const setHelpDialog = useSetAtom(helpDialogAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);

  const newApp = () => {
    setSelectedAppId(null);
    setSelectedChatId(null);
    navigate({ to: "/" });
  };

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Collapsed to icons, the header is the mark alone, centred over the icons below it. */}
            <SidebarMenuButton asChild size="lg" tooltip={tip(TITLE)} className="group-data-[collapsible=icon]:justify-center">
              <Link to="/" onClick={newApp}>
                <PrismMark className="size-6 shrink-0" />
                <span className="font-display text-base font-semibold group-data-[collapsible=icon]:hidden">{TITLE}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={tip("New app")}
                  onClick={newApp}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                >
                  <CirclePlus />
                  <span>New app</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild tooltip={tip(item.title)} isActive={isActive(item.to, item.exact)}>
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <RecentApps />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={tip("Settings")} isActive={isActive("/settings")}>
              <Link to="/settings">
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={tip("Help")} onClick={() => setHelpDialog({ open: true })}>
              <HelpCircle />
              <span>Help</span>
            </SidebarMenuButton>
            <HelpDialog />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

// The user's apps, starred first, then the most recently changed; the open app shows its recent chats.
function RecentApps() {
  const { apps } = useLoadApps();
  const openApp = useOpenApp();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { chats } = useChats(selectedAppId);
  const { selectChat } = useSelectChat();
  const shown = useMemo(
    () =>
      [...apps]
        .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, RECENT_APPS),
    [apps],
  );
  if (!shown.length) return null;
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Your apps</SidebarGroupLabel>
      <SidebarMenu>
        {shown.map((app) => (
          <SidebarMenuItem key={app.id}>
            <SidebarMenuButton isActive={app.id === selectedAppId} onClick={() => openApp(app.id)}>
              <span className="truncate">{app.name}</span>
            </SidebarMenuButton>
            {app.isFavorite && (
              <SidebarMenuBadge>
                <Star className="size-3" />
              </SidebarMenuBadge>
            )}
            {app.id === selectedAppId && chats.length > 0 && (
              <SidebarMenuSub>
                {chats.slice(0, RECENT_CHATS).map((chat) => (
                  <SidebarMenuSubItem key={chat.id}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={chat.id === selectedChatId}
                    >
                      <button type="button" className="w-full" onClick={() => selectChat({ chatId: chat.id, appId: app.id })}>
                        <span className="truncate">{chat.title || "New chat"}</span>
                      </button>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            )}
          </SidebarMenuItem>
        ))}
        {apps.length > shown.length && (
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="text-sidebar-foreground/70">
              <Link to="/apps">
                <span>All apps ({apps.length})</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}

const TITLES: [string, string][] = [
  ["/apps", "Apps"],
  ["/templates", "Templates"],
  ["/library", "Library"],
  ["/plugins", "Plugins"],
  ["/settings", "Settings"],
];
const LIBRARY: Record<string, string> = { themes: "Themes", prompts: "Prompts", media: "Media" };

// Where you are, as a trail: the section, then the page inside it (an app, a plugin, a provider, a part of
// the library). The section links back, so no page needs a back link of its own.
function useTrail(): { title: string; to?: string }[] {
  const isActive = useIsActive();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { apps } = useLoadApps();
  const app = apps.find((a) => a.id === selectedAppId);
  const rest = usePath().split("/").filter(Boolean);
  if (isActive("/chat", true) || isActive("/app-details", true)) return app ? [{ title: "Apps", to: "/apps" }, { title: app.name }] : [{ title: "Apps", to: "/apps" }];
  if (isActive("/providers/$provider", true)) return [{ title: "Settings", to: "/settings" }, { title: decodeURIComponent(rest[1] ?? "") }];
  const section = TITLES.find(([p]) => isActive(p));
  if (!section) return [{ title: "Home" }];
  const sub = rest[1] ? (section[0] === "/library" ? LIBRARY[rest[1]] : decodeURIComponent(rest[1])) : null;
  return sub ? [{ title: section[1], to: section[0] }, { title: sub }] : [{ title: section[1] }];
}

// The site header: the sidebar's trigger and the trail, as in dashboard-01. Its right end is left clear for
// the appearance switch the page shell keeps at the top right.
export function SiteHeader() {
  const trail = useTrail();
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b pr-14 transition-[width,height] ease-linear">
      <div className="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            {trail.map((step, i) => (
              <Fragment key={i}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className="min-w-0">
                  {step.to ? (
                    <BreadcrumbLink asChild>
                      <Link to={step.to}>{step.title}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="truncate text-base font-medium">{step.title}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}
