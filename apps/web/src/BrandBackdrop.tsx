/** 2D pixel adventure backdrop — Codedex-style world, not 3D. */
export function BrandBackdrop() {
  return (
    <div className="pixel-world" aria-hidden="true">
      <div className="pw-sky" />
      <div className="pw-stars" />
      <div className="pw-moon" />
      <div className="pw-cloud pw-cloud-a" />
      <div className="pw-cloud pw-cloud-b" />
      <div className="pw-mountains" />
      <div className="pw-trees" />
      <div className="pw-ground" />
      <div className="pw-path" />
      <div className="pw-campfire" />
      <div className="pw-vignette" />
    </div>
  );
}
