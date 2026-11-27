// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { breadcrumbTrail } from './breadcrumb-trail';

describe('breadcrumbTrail', () => {
  it('names the group and the page of a project route', () => {
    expect(breadcrumbTrail('/projects/hello/domains')).toEqual(['Settings', 'Domains']);
    expect(breadcrumbTrail('/projects/hello/status')).toEqual(['Run', 'Health']);
  });

  it('names only the page when its group has no title', () => {
    expect(breadcrumbTrail('/')).toEqual(['Overview']);
    expect(breadcrumbTrail('/projects/hello')).toEqual(['Overview']);
  });

  it('names the group and the page of a root route', () => {
    expect(breadcrumbTrail('/projects')).toEqual(['Compute', 'Projects']);
    expect(breadcrumbTrail('/billing')).toEqual(['Organization', 'Billing']);
  });

  it('keeps the page of the menu on a route below it', () => {
    expect(breadcrumbTrail('/projects/hello/deployments/abc123')).toEqual(['Deploy', 'Deployments']);
  });

  it('is empty on a route no menu entry leads to', () => {
    expect(breadcrumbTrail('/no-such-page')).toEqual([]);
  });
});
