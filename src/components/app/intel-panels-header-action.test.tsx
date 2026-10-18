// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTEL_HEIGHT, IntelPanelStack } from "@/components/app/intel-panels";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("a panel header action", () => {
  it("shows the action next to the title and does not toggle the panel when pressed", () => {
    const refresh = vi.fn();
    render(
      <IntelPanelStack
        storageKey="test-panels"
        panels={[
          {
            id: "model",
            label: "Models",
            defaultOpen: true,
            headerAction: (
              <button type="button" aria-label="Refresh the model list" onClick={refresh}>
                refresh
              </button>
            ),
            children: <p>model list</p>,
          },
          { id: "last", label: "Last response", defaultOpen: true, children: <p>last reply</p> },
        ]}
      />,
    );

    const toggle = screen.getByRole("button", { name: /Models/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Refresh the model list" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("model list")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("is not a button inside a button, which would be invalid markup", () => {
    const { container } = render(
      <IntelPanelStack
        storageKey="test-panels-nesting"
        panels={[
          {
            id: "model",
            label: "Models",
            defaultOpen: true,
            headerAction: <button type="button" aria-label="Refresh">r</button>,
            children: <p>body</p>,
          },
        ]}
      />,
    );
    expect(container.querySelectorAll("button button").length).toBe(0);
  });

  it("gives the Models panel enough room by default to show its provider filter and list", () => {
    expect(INTEL_HEIGHT.routing).toBeGreaterThanOrEqual(720);
  });
});
