/**
 * The brand mark over the wordmark, at the top of the sign-in and sign-up cards. The image is
 * decorative (`alt=""`): the wordmark is the accessible name, so a screen reader says it once.
 */
export function BrandLockup() {
  return (
    <div className="flex flex-col items-center gap-2">
      <picture>
        <source srcSet="/logo-128.webp" type="image/webp" />
        <img src="/logo-128.png" alt="" width={60} height={60} className="size-[60px]" />
      </picture>
      <span className="font-display text-title-sm font-bold tracking-tight text-foreground">LoopScale</span>
    </div>
  );
}
