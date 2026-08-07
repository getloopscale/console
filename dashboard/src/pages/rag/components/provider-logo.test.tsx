// provider-logo.test.tsx — brand logos for connector providers.

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@/test/render';
import { ProviderLogo } from './provider-logo';

describe('ProviderLogo', () => {
  it('renders the brand logo image for a known provider', () => {
    const { container } = render(<ProviderLogo provider="google-drive" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://cdn.svgporn.com/logos/google-drive.svg');
  });

  it('maps s3 to the Amazon S3 logo', () => {
    const { container } = render(<ProviderLogo provider="s3" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.svgporn.com/logos/aws-s3.svg');
  });

  it('uses a globe (not an <img>) for the website provider', () => {
    const { container } = render(<ProviderLogo provider="web" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to a local icon for an unknown provider', () => {
    const { container } = render(<ProviderLogo provider="mystery" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to a local icon when the logo fails to load', () => {
    const { container } = render(<ProviderLogo provider="dropbox" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
