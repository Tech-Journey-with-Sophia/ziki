import { redirect } from "next/navigation";
import { safeCallbackUrl } from "@/lib/safe-callback-url";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create your Ziki account to collaborate with your team and AI agents.",
};

/**
 * Zedu Bugs uses Google OAuth exclusively. Manual signup is deprecated and disabled.
 * Anyone accessing /signup is redirected to /login with preserved callbackUrl.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
}

