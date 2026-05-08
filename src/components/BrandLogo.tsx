"use client";

// Shared brand mark used across auth pages, NavBar, and dashboard sidebars.
//
// Two source assets exist for different background contrast contexts:
//   - public/logo.png         — orange + black drop on white (used on light
//                                surfaces: auth card, dashboard sidebar header)
//   - public/logo-navbar.png  — orange recolored to pure white, original
//                                white background made transparent. Used on
//                                the dark navy NavBar (#000512) where the
//                                orange asset would visually disappear.
//                                Regenerate with:
//                                  python scripts/utils/generate_navbar_logo.py
//
// Variants map to the three visual contexts in the app:
//   - "navbar"  : NavBar top-left brand link (height 36)
//   - "auth"    : login / forgot-password / reset-password card (height 64)
//   - "sidebar" : dashboard left sidebar header (height 90)
//
// To rebrand the whole app, replace public/logo.png, regenerate
// public/logo-navbar.png via the script above, and adjust the dimensions
// here if the new asset has a different aspect ratio.

import Image from "next/image";

type Variant = "navbar" | "auth" | "sidebar";

interface BrandLogoProps {
  variant: Variant;
  className?: string;
}

// Source PNG is 1243x392 (ratio 3.17). Widths below are computed from the
// target heights so next/image gets numeric width/height; CSS keeps the image
// "contained" inside any narrower parent.
const VARIANTS: Record<Variant, { src: string; w: number; h: number; priority: boolean }> = {
  navbar:  { src: "/logo-navbar.png", w: 114, h: 36, priority: true },
  auth:    { src: "/logo.png",        w: 203, h: 64, priority: true },
  sidebar: { src: "/logo.png",        w: 286, h: 90, priority: false },
};

export default function BrandLogo({ variant, className }: BrandLogoProps) {
  const { src, w, h, priority } = VARIANTS[variant];
  return (
    <Image
      src={src}
      alt="Oil & Gas Data House"
      width={w}
      height={h}
      priority={priority}
      className={className}
      style={{ height: h, width: "auto", maxWidth: "100%", objectFit: "contain" }}
    />
  );
}
