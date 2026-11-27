import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Search,
} from 'lucide-react';
import { Input, Sidebar } from '@getloopscale/ui';
import type { Session } from '@/lib/auth/session';
import { TeamSwitcher } from '@/components/layout/team-switcher';
import { useOnboardingState } from '@/hooks/use-onboarding-state';
import { reportEvent } from '@/lib/telemetry/rum';
import {
  MENUS,
  resolveActiveMenu,
  resolvePlaceholders,
  type MenuDefinition,
  type MenuItem,
} from './app-sidebar-menus';

interface AppSidebarProps {
  session: Session;
}

/**
 * AppSidebar — drill-down stacked navigation (Vercel pattern).
 *
 * The sidebar contents swap entirely when the user enters a submenu (e.g.,
 * clicks "Settings"). A back button at the top returns to the parent menu.
 * Active menu is derived from URL (no manual state stack), so browser
 * back/forward "just works".
 *
 * Animation: CSS `transform: translateX()` + `transition`. Direction is
 * tracked so push (enter submenu) slides from right, pop (back) slides from
 * left — same affordance as Vercel/Linear.
 *
 * SPA navigation per D-1 v1.2 EC-1: NEVER use as="a" href={path} — produces
 * full page reload that loses JWT in memory. Use `as="button" + navigate()`.
 *
 */
/** A row of the menu: 32 pixels high, quiet until hovered. */
const NAV_ROW =
  'relative h-8 gap-2.5 rounded-md px-2.5 py-0 text-[13px] font-normal text-foreground/80 hover:bg-muted/60 hover:text-foreground';
/** The row the user is in: lighter, with a bar in the brand color on its left. */
const NAV_HERE =
  'bg-muted font-medium text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-primary';

export function AppSidebar({ session }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  // Sprint 3 T3.6: Replay onboarding button visible when widget is dismissed.
  const { state: onboardingState, replay: replayOnboarding } = useOnboardingState();

  const resolved = resolveActiveMenu(location.pathname);
  const activeMenuId = resolved.id;
  const activeMenu = MENUS[activeMenuId];
  const parentMenu = activeMenu.parent ? MENUS[activeMenu.parent] : null;
  // Resolve {project} placeholder in menu title (e.g., "{project}" → "acme-web")
  const resolvedTitle = resolvePlaceholders(activeMenu.title, resolved.projectName);

  // Track previous menu id to drive slide direction. Push (entering submenu)
  // slides current panel left + new panel in from right; pop (back) reverses.
  const prevMenuIdRef = useRef(activeMenuId);
  const [slideDirection, setSlideDirection] = useState<'none' | 'push' | 'pop'>('none');
  useEffect(() => {
    const prev = prevMenuIdRef.current;
    if (prev === activeMenuId) return;
    const prevDepth = MENUS[prev]?.parent ? 1 : 0;
    const currentDepth = activeMenu.parent ? 1 : 0;
    setSlideDirection(currentDepth > prevDepth ? 'push' : 'pop');
    prevMenuIdRef.current = activeMenuId;
    // Animation duration matches CSS below (180ms standard motion token)
    const t = setTimeout(() => setSlideDirection('none'), 200);
    return () => clearTimeout(t);
  }, [activeMenuId, activeMenu.parent]);

  const userName =
    session.identity.traits.name ?? session.identity.traits.email;

  const isActive = (path: string) => {
    // Resolve placeholders in the target path (so /projects/{project}/secrets
    // becomes /projects/acme-web/secrets for matching)
    const resolvedPath = resolvePlaceholders(path, resolved.projectName);
    if (resolvedPath === '/') return location.pathname === '/';
    // Submenu items: exact match only (else "General" /settings would also light
    // up when on /settings/members because startsWith would match)
    if (activeMenu.id !== 'main') {
      return location.pathname === resolvedPath;
    }
    return location.pathname.startsWith(resolvedPath);
  };

  // T5.3: View Transitions API wraps navigation — smooth crossfade entre
  // menus em browsers que suportam (Chrome 111+/Safari 18+). Firefox cai
  // no fallback (chamada síncrona, sem animação extra), keyframes CSS
  // existentes continuam funcionando.
  const handleItemClick = (item: MenuItem) => {
    const resolvedPath = resolvePlaceholders(item.path, resolved.projectName);
    // PLAIN navigate — NO View Transition (live-test-gaps-fix F-4, corrected after
    // live verification). The sub-nav routes are lazy + Suspense with no Outlet;
    // wrapping navigate in a View Transition (raw document.startViewTransition OR
    // react-router v7's native `{ viewTransition: true }`) snapshots the old DOM
    // before the lazy route chunk commits, leaving the panel stale until reload
    // (React 19 + RR v7). Plain navigate is the proven pre-T5.3 behavior: the panel
    // re-renders on click. Crossfade is sacrificed for correctness.
    navigate(resolvedPath);
  };

  const handleBack = () => {
    if (!parentMenu) return;
    // Pop to parent context. Project drill-down → /projects (list user came
    // from). Settings/profile drill-down → root (no natural "previous page").
    // PLAIN navigate (no View Transition) — see handleItemClick (F-4).
    if (activeMenuId === 'project') {
      navigate('/projects');
    } else {
      navigate('/');
    }
  };

  // Panel content (shared between push/pop animations)
  const renderPanel = (menu: MenuDefinition) => (
    <>
      {menu.parent ? (
        <Sidebar.Header className="h-12 shrink-0 border-border px-3">
          <button
            type="button"
            onClick={handleBack}
            className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label={`Back to ${MENUS[menu.parent].title}`}
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
            <span>Back</span>
          </button>
          <p
            className="ml-auto min-w-0 truncate text-[13px] font-semibold tracking-tight text-foreground"
            title={resolvedTitle}
          >
            {resolvedTitle}
          </p>
        </Sidebar.Header>
      ) : (
        <Sidebar.Header className="h-12 shrink-0 border-border px-3">
          <TeamSwitcher fallbackName={userName} />
        </Sidebar.Header>
      )}

      {/* Search only on root menu — submenus don't need project search */}
      {!menu.parent && (
        <Sidebar.Section className="px-3 py-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="Find a project..."
              aria-label="Find a project"
              className="pl-8"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const q = searchValue.trim();
                  if (q) {
                    navigate(`/projects?q=${encodeURIComponent(q)}`);
                    setSearchValue('');
                  }
                }
              }}
            />
          </div>
        </Sidebar.Section>
      )}

      {/* Render each group as its own Sidebar.Section. Optional `title` shows
       * as uppercase subheading; untitled groups separate visually via section
       * spacing without a label (the "footer-nav" pattern: Settings/Profile
       * clustered apart from main nav without needing a heading). */}
      {menu.groups.map((group, groupIndex) => (
        <Sidebar.Section
          key={`${menu.id}-group-${groupIndex}`}
          title={group.title}
        >
          {group.items.map((item) => {
            const Icon = item.icon;
            return (
              <Sidebar.Item
                key={item.path + ':' + item.label}
                as="button"
                active={isActive(item.path)}
                className={`${NAV_ROW} ${isActive(item.path) ? NAV_HERE : ''}`}
                onClick={() => handleItemClick(item)}
                title={
                  resolvePlaceholders(item.label, resolved.projectName) +
                  (item.comingSoon ? ' — coming soon' : '')
                }
              >
                {/* Single child wrapper — Sidebar.Item composite renders children
                 * as a single block; passing two siblings (label + chevron) let
                 * the composite's internal layout stack them vertically. Wrapping
                 * in one flex container guarantees horizontal placement with the
                 * chevron pinned right via justify-between. */}
                <span className="flex w-full items-center gap-2.5">
                  <Icon
                    className={`size-4 shrink-0 ${isActive(item.path) ? '' : 'opacity-80'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {/* O selo e visual E textual: `aria-hidden` aqui deixaria quem usa
                   * leitor de tela com uma entrada indistinguivel das prontas. O
                   * nome acessivel vem do `title` acima, que ja carrega
                   * "— coming soon"; este span so evita a repeticao em voz alta. */}
                  {item.comingSoon && (
                    <span
                      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                      aria-hidden="true"
                    >
                      Soon
                    </span>
                  )}
                  {item.drillsInto && (
                    <ChevronRight
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </span>
              </Sidebar.Item>
            );
          })}
        </Sidebar.Section>
      ))}
    </>
  );

  // Slide-in classes: chosen per direction. CSS transitions defined inline so
  // we don't need a global stylesheet edit for this single component.
  const slideClass =
    slideDirection === 'push'
      ? 'animate-[slidein-right_180ms_ease-out]'
      : slideDirection === 'pop'
        ? 'animate-[slidein-left_180ms_ease-out]'
        : '';

  return (
    <>
      {/* Inline keyframes — kept here (not in index.css) so the StackedSidebar
       * concern is fully colocated. ~10 lines, no global pollution. */}
      <style>{`
        @keyframes slidein-right {
          from { transform: translateX(12%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slidein-left {
          from { transform: translateX(-12%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
      <Sidebar>
        <div key={activeMenuId} className={`flex flex-col h-full ${slideClass}`}>
          {renderPanel(activeMenu)}

          <Sidebar.Footer className="mt-auto border-t border-border/60">
            <div className="px-3 py-3 space-y-2">
              <a
                href="https://docs.getloopscale.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-body-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              >
                <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
                <span>Documentation</span>
              </a>
              {/* Sprint 3 T3.6: Replay onboarding link — visible only when
                  user dismissed widget. EC-06 ensures replay() works even when
                  all steps complete (resets DEFAULT_STATE). */}
              {onboardingState.dismissed && (
                <button
                  type="button"
                  onClick={() => {
                    replayOnboarding();
                    reportEvent('onboarding_replayed');
                  }}
                  className="flex items-center gap-2 text-body-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                >
                  <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>Replay onboarding</span>
                </button>
              )}
            </div>
          </Sidebar.Footer>
        </div>
      </Sidebar>
    </>
  );
}
