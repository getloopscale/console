import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';
import { VerificationBanner } from './verification-banner';

describe('VerificationBanner', () => {
  it('test_verification_banner_renders_alert_warning', () => {
    render(<VerificationBanner />);
    expect(screen.getByText('Verify your email')).toBeInTheDocument();
    expect(
      screen.getByText(/check your inbox for a verification code/i),
    ).toBeInTheDocument();
  });

  it('does not claim that an unverified account cannot deploy', () => {
    // No API refuses a deploy over an unverified address, so the banner must not say one does.
    render(<VerificationBanner />);
    expect(screen.getByRole('status')).not.toHaveTextContent(/can't deploy/i);
  });

  it('test_verification_banner_renders_verify_action_link', () => {
    render(<VerificationBanner />);
    const link = screen.getByRole('link', { name: /verify now/i });
    expect(link).toBeInTheDocument();
    // Kratos verification URL from lib/auth getVerificationURL()
    expect(link.getAttribute('href')).toMatch(/self-service\/verification\/browser/);
  });

  it('test_verification_banner_uses_alert_primitive_role_status', () => {
    const { container } = render(<VerificationBanner />);
    // Alert with intent="warning" uses role="status" per .llms.txt Brief #3 spec
    // (only destructive uses role="alert"); semantic check confirms primitive usage.
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });
});
