import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

export interface TagsResult {
  tags: string[];
}

const TRACES_PATH = '/v1/dashboard/lens/traces';

/** The tags of one trace. Built here so the read and the three writes cannot disagree about it. */
function tagsKey(traceId: string) {
  return ['cloud', TRACES_PATH, traceId, 'tags'] as const;
}

function tagsUrl(traceId: string) {
  return `${TRACES_PATH}/${encodeURIComponent(traceId)}/tags`;
}

/**
 * The tags and annotations attached to a trace.
 *
 * B-244 — the card built four requests itself. Three of them carried no error contract, and all
 * three fail the same way: the write is refused, `onSuccess` fires anyway, the input clears, and
 * the user is told nothing.
 *
 * The three are not equally bad, and the third is the one worth naming:
 *
 *   addTag — the field clears and the tag is simply absent on the next read. Reads as "it did not
 *   save" only if the user happens to look.
 *
 *   removeTag — the confirmation closes and the tag reappears on the next read, which reads as the
 *   product undoing the user's action.
 *
 *   addAnnotation — the user WROTE something. The textarea clears, the note is gone, and there is
 *   no error and no draft to recover. Of the three, this is the one that destroys work rather than
 *   merely misreporting state.
 *
 * With `{ throwOnError: true }` a refusal arrives as an `ApiError` and `onSuccess` does not run, so
 * the input keeps what the user typed.
 */
export function useTraceTags(traceId: string) {
  return useQuery({
    queryKey: tagsKey(traceId),
    queryFn: () => cloudFetch<TagsResult>(tagsUrl(traceId), {}, { throwOnError: true }),
  });
}

export function useAddTraceTag(traceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tag: string) =>
      cloudFetch<TagsResult>(
        tagsUrl(traceId),
        { method: 'POST', body: JSON.stringify({ tag }) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagsKey(traceId) });
    },
  });
}

export function useRemoveTraceTag(traceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tag: string) =>
      cloudFetch<TagsResult>(
        `${tagsUrl(traceId)}?tag=${encodeURIComponent(tag)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagsKey(traceId) });
    },
  });
}

/**
 * Attach a note to a trace.
 *
 * No invalidation on purpose: annotations are not read back by this card, so invalidating the tags
 * key here would refetch something unrelated to what changed. If a future screen lists annotations,
 * the key for that list belongs next to this mutation — not bolted onto the tags one because it
 * happens to be nearby.
 */
export function useAddTraceAnnotation(traceId: string) {
  return useMutation({
    mutationFn: (note: string) =>
      cloudFetch<unknown>(
        `${TRACES_PATH}/${encodeURIComponent(traceId)}/annotations`,
        { method: 'POST', body: JSON.stringify({ note }) },
        { throwOnError: true },
      ),
  });
}
