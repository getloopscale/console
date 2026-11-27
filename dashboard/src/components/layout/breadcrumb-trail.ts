import { MENUS, resolveActiveMenu, resolvePlaceholders } from './app-sidebar-menus';

/**
 * Where the user is, as the menu names it: the group and the page. The top bar shows it next to
 * the project selector, which already names the project.
 *
 * The page is the menu entry whose path is the current one, or the longest one the current path
 * sits below. A route no entry leads to has no trail.
 */
export function breadcrumbTrail(pathname: string): string[] {
  const resolved = resolveActiveMenu(pathname);
  const menu = MENUS[resolved.id];
  if (!menu) return [];

  let best: { trail: string[]; length: number } | undefined;
  for (const group of menu.groups) {
    for (const item of group.items) {
      const path = resolvePlaceholders(item.path, resolved.projectName);
      const exact = pathname === path;
      const below = path !== '/' && pathname.startsWith(`${path}/`);
      if (!exact && !below) continue;
      if (!best || path.length > best.length) {
        best = { trail: group.title ? [group.title, item.label] : [item.label], length: path.length };
      }
    }
  }
  return best?.trail ?? [];
}
