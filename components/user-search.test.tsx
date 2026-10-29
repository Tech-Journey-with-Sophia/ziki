// @vitest-environment jsdom
"use client";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserSearch } from "./user-search";

const { pushMock, searchParamsRef } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsRef.current,
}));

afterEach(() => cleanup());

beforeEach(() => {
  pushMock.mockReset();
  searchParamsRef.current = new URLSearchParams();
});

function renderUserSearch() {
  return render(<UserSearch />);
}

function searchInput() {
  return screen.getByLabelText(
    "Search users by name or email",
  ) as HTMLInputElement;
}

describe("UserSearch", () => {
  it("seeds the input from the q URL parameter", () => {
    searchParamsRef.current = new URLSearchParams("q=crash");

    renderUserSearch();

    expect(searchInput().value).toBe("crash");
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });

  it("pushes the trimmed query as the q parameter on submit", async () => {
    const user = userEvent.setup({ delay: null });
    renderUserSearch();

    await user.type(searchInput(), "  linux crash  ");
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/admin/users?q=linux+crash"),
    );
  });

  it("drops the q parameter when the submitted query is blank", async () => {
    searchParamsRef.current = new URLSearchParams("page=2");
    const user = userEvent.setup({ delay: null });
    renderUserSearch();

    await user.type(searchInput(), "   ");
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/admin/users?page=2"),
    );
  });

  it("clears the input and removes the q parameter", async () => {
    searchParamsRef.current = new URLSearchParams("q=crash");
    const user = userEvent.setup({ delay: null });
    renderUserSearch();

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchInput().value).toBe("");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/users"));
  });
});
