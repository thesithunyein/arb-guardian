/** Soft night scene — flat 2D Codedex-style world (always on). */
export function BrandBackdrop() {
  return (
    <div className="pixel-world" aria-hidden="true">
      <div className="pw-sky" />
      <div className="pw-stars" />
      <div className="pw-moon" />
      <div className="pw-hill pw-hill-a" />
      <div className="pw-hill pw-hill-b" />
      <div className="pw-ground" />
      <div className="pw-path" />
      <div className="pw-campfire" />
      <div className="pw-vignette" />
    </div>
  );
}
