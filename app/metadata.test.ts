import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { metadata as layoutMetadata } from "./layout";
import { metadata as signupMetadata } from "./(auth)/signup/page";

describe("Root and auth page metadata (#689)", () => {
  it("has modern product copy in root metadata description without bootcamp/placeholder wording", () => {
    expect(layoutMetadata.description).toBeDefined();
    expect(layoutMetadata.description).not.toContain("HNG");
    expect(layoutMetadata.description).not.toContain("mini-project");
    expect(layoutMetadata.description).not.toContain("bootcamp");
    expect(layoutMetadata.description).toContain("Bring your team's issues into one place");
  });

  it("sets og:description and twitter:description consistent with root description", () => {
    expect(layoutMetadata.openGraph?.description).toBe(layoutMetadata.description);
    expect(layoutMetadata.twitter?.description).toBe(layoutMetadata.description);
  });

  it("exports dedicated title and description on /signup page", () => {
    expect(signupMetadata.title).toBe("Sign up");
    expect(signupMetadata.description).toBeDefined();
    expect(signupMetadata.description).not.toContain("HNG");
    expect(signupMetadata.description).not.toContain("mini-project");
  });
});
