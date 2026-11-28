import { Box, KeyRound, Package } from 'lucide-react';
import type { MenuDefinition } from '@/components/layout/app-sidebar-menus';

/**
 * The sidebar of the Sandboxes area. The page of one sandbox is not listed: it is reached
 * from the list, and `resolveActiveMenu` keeps this menu open on it.
 */
export const SANDBOXES_MENU: MenuDefinition = {
  id: 'sandboxes',
  title: 'Sandboxes',
  parent: 'main',
  groups: [
    {
      items: [
        { label: 'Sandboxes', path: '/sandboxes', icon: Box },
        { label: 'Templates', path: '/sandboxes/templates', icon: Package },
        { label: 'Secrets', path: '/sandboxes/secrets', icon: KeyRound },
      ],
    },
  ],
};
