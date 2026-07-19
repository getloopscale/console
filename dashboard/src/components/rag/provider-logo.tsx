import { useState } from 'react';
import { Globe, Plug } from 'lucide-react';

/**
 * Brand-logo slug for each connector provider, resolved from the gilbarbara/logos CDN
 * (full-colour SVGs, served over HTTPS — allowed by the app CSP `img-src ... https:`).
 * A provider absent from this map (or whose logo 404s) falls back to a neutral local icon,
 * so a logo is never a broken image.
 */
const LOGO_SLUG: Record<string, string> = {
  'google-drive': 'google-drive',
  gmail: 'google-gmail',
  dropbox: 'dropbox',
  box: 'box',
  'microsoft-365': 'microsoft',
  salesforce: 'salesforce',
  confluence: 'confluence',
  jira: 'jira',
  s3: 'aws-s3',
};

function logoUrl(slug: string): string {
  return `https://cdn.svgporn.com/logos/${slug}.svg`;
}

/**
 * ProviderLogo — the brand logo for a connector provider (Google Drive, Dropbox, Amazon S3…).
 * Decorative: `web` uses a globe, an unknown provider or a failed CDN load falls back to a plug
 * icon. `alt=""` + `aria-hidden` keep it out of the a11y tree (the provider name is the label).
 */
export function ProviderLogo({ provider, className = 'h-4 w-4' }: { readonly provider: string; readonly className?: string }) {
  const [failed, setFailed] = useState(false);

  if (provider === 'web') return <Globe className={className} aria-hidden="true" />;

  const slug = LOGO_SLUG[provider];
  if (!slug || failed) return <Plug className={className} aria-hidden="true" />;

  return (
    <img
      src={logoUrl(slug)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className={`${className} shrink-0 object-contain`}
      onError={() => setFailed(true)}
    />
  );
}
