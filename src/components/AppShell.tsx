import { ChevronLeft, Languages, Moon, Search, Settings2, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CloudButton } from "../cloud/CloudUI";
import { useSettings } from "../db/settings";
import { NAV_ORDER, PARTS, partOfPath } from "./parts";
import { useUI } from "./ui";

export function ToolButton({
  label,
  onClick,
  children,
  active,
  className,
}: {
  label: ReactNode;
  onClick(): void;
  children: ReactNode;
  /** a toggle that is on */
  active?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={typeof label === "string" ? label : undefined}
          aria-pressed={active}
          className={cn(active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Look-up, theme and settings buttons on the right of both top bars. */
function NavTools() {
  const ui = useUI();
  const [s, set] = useSettings();
  const dark = s.theme === "dark" || (s.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <>
      <CloudButton />
      <ToolButton label="查词（法语或中文）" onClick={ui.toggleDict}>
        <Languages />
      </ToolButton>
      <ToolButton label={dark ? "切换到浅色" : "切换到深色"} onClick={() => set({ theme: dark ? "light" : "dark" })}>
        {dark ? <Sun /> : <Moon />}
      </ToolButton>
      <ToolButton label="设置" onClick={ui.openSettings}>
        <Settings2 />
      </ToolButton>
    </>
  );
}

/** Top navigation of every page except practice / exam / flashcard sessions (those have the compact SessionBar). */
export function AppNav() {
  const ui = useUI();
  const { pathname } = useLocation();
  const active = partOfPath(pathname);
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4">
          <Link to="/" className="mr-3 flex items-center gap-2 text-[17px] font-extrabold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground">TCF</span>
            <span className="hidden sm:inline">
              TCF <span className="text-primary">练习</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ORDER.map((k) => {
              const p = PARTS[k];
              const on = active === k;
              return (
                <Link
                  key={k}
                  to={p.path}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
                    on ? `${p.soft} ${p.text}` : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <p.icon className="size-4" />
                  {p.name}
                </Link>
              );
            })}
          </nav>
          <span className="flex-1" />
          <Button variant="ghost" className="hidden h-8 gap-2 px-2.5 text-muted-foreground lg:flex" onClick={() => ui.openSearch()}>
            <Search className="size-4" />
            搜索题目
            <Kbd>⌘K</Kbd>
          </Button>
          <span className="lg:hidden">
            <ToolButton label="搜索（/ 或 ⌘K）" onClick={() => ui.openSearch()}>
              <Search />
            </ToolButton>
          </span>
          <NavTools />
        </div>
      </header>
      {/* phones: the five sections move to a bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {NAV_ORDER.map((k) => {
          const p = PARTS[k];
          const on = active === k;
          return (
            <Link key={k} to={p.path} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground", on && p.text)}>
              <p.icon className="size-5" />
              {p.name}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/** Compact top bar of a practice, exam or flashcard session: back link, title, session buttons, tools. */
export function SessionBar({ back, title, children }: { back: { to: string; label?: string }; title?: ReactNode; children?: ReactNode }) {
  const ui = useUI();
  return (
    <header className="sticky top-0 z-40 box-content flex h-14 items-center gap-1 border-b bg-background/85 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:px-4">
      <Link to={back.to} className="flex shrink-0 items-center rounded-lg py-1 pr-2 pl-1 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
        <ChevronLeft className="size-4" />
        {back.label ?? "返回"}
      </Link>
      {title && <div className="min-w-0 truncate border-l pl-3 text-sm font-semibold max-sm:hidden">{title}</div>}
      <span className="flex-1" />
      {children}
      <ToolButton label="搜索（/ 或 ⌘K）" onClick={() => ui.openSearch()}>
        <Search />
      </ToolButton>
      <NavTools />
    </header>
  );
}

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className={cn("mx-auto max-w-6xl px-4 pt-6 pb-24 md:pb-14", className)}>{children}</main>
    </div>
  );
}

export function PageHeader({
  kicker,
  kickerClass,
  title,
  description,
  actions,
  back,
}: {
  kicker?: ReactNode;
  kickerClass?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-2 inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" />
            {back.label}
          </Link>
        )}
        {kicker && <div className={cn("mb-1 text-xs font-semibold tracking-[0.14em] uppercase", kickerClass ?? "text-primary")}>{kicker}</div>}
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A card that links somewhere: title row with an arrow, body below. */
export function LinkCard({
  to,
  title,
  sub,
  icon,
  className,
  children,
}: {
  to: string;
  title: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group/lc flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgb(16_24_40/0.08)]",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="font-bold">{title}</div>
          {sub && <div className="mt-0.5 text-[13px] text-muted-foreground">{sub}</div>}
        </div>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-background transition-transform group-hover/lc:translate-x-0.5">
          <ChevronLeft className="size-4 rotate-180" />
        </span>
      </div>
      {children}
    </Link>
  );
}

export function Stat({ value, label, className }: { value: ReactNode; label: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-2xl leading-none font-extrabold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function Bar({ value, className, fill }: { value: number; className?: string; fill?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full bg-primary transition-[width]", fill)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}
