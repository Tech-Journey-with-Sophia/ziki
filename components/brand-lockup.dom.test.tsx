// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandLockup } from "./brand-lockup";

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => <span data-testid="img" aria-hidden={props.alt === ""} />,
}));

afterEach(() => cleanup());

describe("BrandLockup (#1063)", () => {
  it("reads Ziki, not Ziki Issues", () => {
    render(<BrandLockup href="/issues" />);
    const link = screen.getByRole("link", { name: "Ziki" });
    expect(link).toHaveAttribute("href", "/issues");
    expect(link).toHaveTextContent(/^Ziki$/);
  });

  it("names the unlinked lockup Ziki too", () => {
    const { container } = render(<BrandLockup />);
    expect(container.querySelector('[aria-label="Ziki"]')).toHaveTextContent(/^Ziki$/);
  });

  it("renders dark variant with light text (#424)", () => {
    const { container } = render(<BrandLockup variant="dark" />);
    const textSpan = container.querySelector("span.text-white");
    expect(textSpan).toBeInTheDocument();
    expect(textSpan).toHaveTextContent(/^Ziki$/);
  });

  it("renders md hero size (#424)", () => {
    const { container } = render(<BrandLockup size="md" />);
    const textSpan = container.querySelector("span.text-2xl");
    expect(textSpan).toBeInTheDocument();
  });
});

