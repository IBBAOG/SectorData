"use client";

// Shared brand mark used across auth pages, NavBar, and dashboard sidebars.
// Source asset: public/logo.png (Oil & Gas Data House — orange + black drop).
//
// Variants map to the three visual contexts in the app:
//   - "navbar"  : NavBar top-left brand link (height 36)
//   - "auth"    : login / forgot-password / reset-password card (height 64)
//   - "sidebar" : dashboard left sidebar header (height 60)
//
// To rebrand the whole app, replace public/logo.png (and adjust the dimensions
// here if the new asset has a different aspect ratio).

import Image from "next/image";

type Variant = "navbar" | "auth" | "sidebar";

interface BrandLogoProps {
  variant: Variant;
  className?: string;
}

// Source PNG is 1243x392 (ratio 3.17). Widths below are computed from the
// target heights so next/image gets numeric width/height; CSS keeps the image
// "contained" inside any narrower parent.
const DIMS: Record<Variant, { w: number; h: number; priority: boolean }> = {
  navbar:  { w: 114, h: 36, priority: true },
  auth:    { w: 203, h: 64, priority: true },
  sidebar: { w: 190, h: 60, priority: false },
};

export default function BrandLogo({ variant, className }: BrandLogoProps) {
  const { w, h, priority } = DIMS[variant];
  return (
    <Image
      src="/logo.png"
      alt="Oil & Gas Data House"
      width={w}
      height={h}
      priority={priority}
      className={className}
      style={{ height: h, width: "auto", maxWidth: "100%", objectFit: "contain" }}
    />
  );
}
