"use client";

// Centered barrel loading indicator used by every dashboard while the initial
// fetch is in flight.
//
//   <BarrelLoading />            — default size 160
//   <BarrelLoading size={120} /> — used inside the Export panel overlay
//
// Wraps the `<Image>` (next/image) call so the same alt text and dimensions
// are reused everywhere, and so we get the lint-clean version once.

import Image from "next/image";

export interface BarrelLoadingProps {
  size?: number;
  alt?: string;
  /** Render without the bootstrap centering wrapper (useful inside flex parents). */
  bare?: boolean;
}

export default function BarrelLoading({ size = 160, alt = "Loading...", bare = false }: BarrelLoadingProps) {
  const img = <Image src="/barrel_loading.png" alt={alt} width={size} height={size} />;
  if (bare) return img;
  return (
    <div className="d-flex justify-content-center my-5">
      {img}
    </div>
  );
}
