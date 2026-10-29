import Image from "next/image";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";

type BrandLockupProps = {
  /** When set, wraps the lockup in a link. Omit on auth pages. */
  href?: string;
  size?: "sm" | "md";
  showWordmark?: boolean;
  variant?: "light" | "dark";
};

/** Distinctive platform mark: issue tracking and agent coordination built around the core Z mark. */
const sizes = {
  sm: { px: 28, className: "h-7 w-7" },
  md: { px: 44, className: "h-11 w-11" },
} as const;

export function BrandLockup({
  href,
  size = "sm",
  showWordmark = true,
  variant = "light",
}: BrandLockupProps) {
  const dim = sizes[size];
  const textColor = variant === "dark" ? "text-white" : "text-slate-900";
  const content = (
    <>
      <Image
        src={BASE_PATH ? `${BASE_PATH}/ziki-mark.svg` : "/ziki-mark.svg"}
        alt=""
        width={dim.px}
        height={dim.px}
        className={dim.className}
        unoptimized
        priority={size === "md"}
      />
      {showWordmark ? (
        <span
          className={
            size === "md"
              ? `text-2xl font-semibold tracking-tight ${textColor}`
              : `whitespace-nowrap text-lg font-semibold tracking-tight ${textColor}`
          }
        >
          Ziki
        </span>
      ) : null}
    </>
  );

  if (!href) {
    return (
      <div className="inline-flex items-center gap-2.5" aria-label="Ziki">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2.5"
      aria-label="Ziki"
    >
      {content}
    </Link>
  );
}
