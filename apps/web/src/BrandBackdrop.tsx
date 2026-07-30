/** Soft night scene — full game world on title; quiet gradient once in product. */
export function BrandBackdrop({ quiet = false }: { quiet?: boolean }) {
  return (
    <div className={`pixel-world${quiet ? " quiet" : ""}`} aria-hidden="true">
      <div className="pw-sky" />
      {!quiet && (
        <>
          <div className="pw-stars" />
          <div className="pw-moon" />
          <div className="pw-hill pw-hill-a" />
          <div className="pw-hill pw-hill-b" />
          <div className="pw-ground" />
          <div className="pw-path" />
          <div className="pw-campfire" />
        </>
      )}
      <div className="pw-vignette" />
    </div>
  );
}
