import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import { fetchGitHubInstallations } from './github-connect';

/**
 * The GitHub App installations GitHub confirmed for the signed-in user's team.
 *
 * Read once per visit to the connect page. The page does not poll it: the GitHub authorization
 * happens in the same tab, and the browser comes back to a fresh page load when it is done.
 */
export function useGitHubInstallations({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: queryKeys.integrations.githubInstallations,
    queryFn: fetchGitHubInstallations,
    enabled,
  });
}
