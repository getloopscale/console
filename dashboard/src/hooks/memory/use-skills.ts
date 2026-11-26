import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface SkillWithRepo {
  id: string;
  hash: string;
  description: string;
  code: string | null;
  codeLanguage: string | null;
  createdAt: string;
  derivedFrom: string[];
  supersededBy: string | null;
  repoId: string;
}

export interface SkillsAllResult {
  skills: SkillWithRepo[];
  total: number;
  truncated: boolean;
}

export const SKILLS_PAGE_SIZE = 25;

const skillsQueryKey = ['cloud', '/v1/dashboard/memory/skills/all'] as const;

/**
 * The cross-repo skill list.
 *
 * `throwOnError` so a failed fetch is `isError` rather than an empty list rendered as "no skills"
 * (loop-console#250).
 */
export function useSkills(filters: { q: string; offset: number }) {
  const { q, offset } = filters;

  return useQuery({
    queryKey: [...skillsQueryKey, { q, offset }] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('limit', String(SKILLS_PAGE_SIZE));
      if (offset > 0) params.set('offset', String(offset));
      if (q !== '') params.set('q', q);

      return cloudFetch<SkillsAllResult>(
        `/v1/dashboard/memory/skills/all?${params.toString()}`,
        {},
        { throwOnError: true },
      );
    },
  });
}

/**
 * Forget a skill — the ONLY write this feature has (D2 guardrail: no editor, no create, no
 * executor). The delete is scoped by the row's own `repoId`, which is why the whole row is the
 * argument rather than the id.
 *
 * B-235 — without the contract a refused DELETE resolved `null`, the confirmation closed and the
 * skill returned on the next read. On a curation screen whose entire purpose is removing a bad
 * skill, that is the product appearing to undo the one action it offers.
 */
export function useForgetSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (skill: { id: string; repoId: string }): Promise<void> => {
      await cloudFetch(
        `/v1/dashboard/memory/skills/${encodeURIComponent(skill.id)}?repoId=${encodeURIComponent(skill.repoId)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillsQueryKey });
    },
  });
}
