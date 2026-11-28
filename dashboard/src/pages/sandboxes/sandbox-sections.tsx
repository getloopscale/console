import { NavLink } from 'react-router-dom';

const SECTIONS = [
  { to: '/sandboxes', label: 'Sandboxes' },
  { to: '/sandboxes/templates', label: 'Templates' },
  { to: '/sandboxes/secrets', label: 'Secrets' },
];

/** The links between the screens of the Sandboxes area. */
export function SandboxSections() {
  return (
    <nav aria-label="Sandbox sections" className="flex gap-4 text-body-sm">
      {SECTIONS.map((section) => (
        <NavLink
          key={section.to}
          to={section.to}
          end
          className={({ isActive }) =>
            isActive
              ? 'font-medium text-foreground underline underline-offset-4'
              : 'text-muted-foreground hover:text-foreground'
          }
        >
          {section.label}
        </NavLink>
      ))}
    </nav>
  );
}
