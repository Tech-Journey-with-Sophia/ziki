// @vitest-environment jsdom
"use client";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pairAgentAction = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({ pairAgentAction }));

import { PairForm } from "./pair-form";

function renderForm(instructions: string | null) {
  return render(
    <PairForm
      initialCode="ABCD-2345"
      pending={{ name: "Ada's Claude", model: "Claude", level: "working", instructions }}
      unknownCode={false}
      projects={[{ id: "project_1", name: "Ziki" } as never]}
      activeProjectId="project_1"
      instructionsMaxLength={4000}
    />,
  );
}

describe("PairForm standing instructions (#431)", () => {
  beforeEach(() => {
    pairAgentAction.mockReset();
  });
  afterEach(() => cleanup());

  it("pre-fills the agent's proposal for the owner to review", () => {
    renderForm("Focus on desktop bugs.");
    const box = screen.getByLabelText(/Standing instructions/) as HTMLTextAreaElement;
    expect(box.value).toBe("Focus on desktop bugs.");
    expect(box.maxLength).toBe(4000);
  });

  it("keeps the owner's edit after a failed approval, and resubmits it rather than the proposal", async () => {
    pairAgentAction.mockResolvedValue({ ok: false, error: "Choose a project in this workspace." });
    renderForm("Focus on desktop bugs.");
    const box = screen.getByLabelText(/Standing instructions/) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Owner-edited brief." } });

    fireEvent.click(screen.getByRole("button", { name: "Approve agent" }));
    await screen.findByText("Choose a project in this workspace.");
    expect((screen.getByLabelText(/Standing instructions/) as HTMLTextAreaElement).value).toBe("Owner-edited brief.");

    fireEvent.click(screen.getByRole("button", { name: "Approve agent" }));
    await waitFor(() => expect(pairAgentAction).toHaveBeenCalledTimes(2));
    const retried = pairAgentAction.mock.calls[1][1] as FormData;
    expect(retried.get("instructions")).toBe("Owner-edited brief.");
  });

  it("keeps cleared instructions cleared after a failed approval", async () => {
    pairAgentAction.mockResolvedValue({ ok: false, error: "Choose a project in this workspace." });
    renderForm("Focus on desktop bugs.");
    fireEvent.change(screen.getByLabelText(/Standing instructions/), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Approve agent" }));
    await screen.findByText("Choose a project in this workspace.");
    expect((screen.getByLabelText(/Standing instructions/) as HTMLTextAreaElement).value).toBe("");
  });

  it("auto-formats the pairing code and disables Continue until valid", () => {
    render(
      <PairForm
        initialCode=""
        pending={null}
        unknownCode={false}
        projects={[{ id: "project_1", name: "Ziki" } as never]}
        activeProjectId="project_1"
        instructionsMaxLength={4000}
      />,
    );
    const input = screen.getByLabelText(/Pairing code/) as HTMLInputElement;
    const continueBtn = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "abcd2345" } });
    expect(input.value).toBe("ABCD-2345");
    expect(continueBtn.disabled).toBe(false);
  });

});
