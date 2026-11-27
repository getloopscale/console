/**
 * An image reference without the host of its registry. The registry of tenant images belongs to
 * the platform: its host is an internal address on staging and carries the platform's account on
 * AWS. The repository, tag and digest are what identify the image to its owner.
 */
export function withoutRegistryHost(reference: string): string {
  const slash = reference.indexOf('/');
  if (slash <= 0) return reference;
  const first = reference.slice(0, slash);
  // The OCI rule for telling a host from the first path segment of a repository.
  const isHost = first.includes('.') || first.includes(':') || first === 'localhost';
  return isHost ? reference.slice(slash + 1) : reference;
}
