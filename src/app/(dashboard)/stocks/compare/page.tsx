"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CompareRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/stocks"); }, [router]);
  return null;
}
