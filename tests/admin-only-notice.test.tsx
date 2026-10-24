/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminOnlyNotice } from "@/components/app/admin-only-notice";
import { TaskModelsPanel } from "@/components/app/task-models-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubTaskModels(canEdit: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ purposes: [{ purpose: "fileFormat", choice: null }], canEdit }), { status: 200 })),
  );
}

describe("Admin-only notices for members", () => {
  it("says who can change it, with the default or a specific hint", () => {
    const { rerender } = render(<AdminOnlyNotice />);
    expect(screen.getByText("Only an Admin can change this")).toBeTruthy();
    expect(screen.getByText(/ask your administrator/)).toBeTruthy();
    rerender(<AdminOnlyNotice>You can propose a change.</AdminOnlyNotice>);
    expect(screen.getByText("You can propose a change.")).toBeTruthy();
  });

  it("task models: a member sees the notice and no Change button; an Admin sees neither", async () => {
    stubTaskModels(false);
    const props = { models: [], voiceLabel: "Groq", voiceDestination: "Audio goes to Groq.", onChangeVoice: () => {} };
    const { unmount } = render(<TaskModelsPanel {...props} />);
    await waitFor(() => expect(screen.getByText("Only an Admin can change this")).toBeTruthy());
    expect(screen.getByText("An Admin chooses the voice provider.")).toBeTruthy();
    expect(screen.queryByText("Change")).toBeNull();
    unmount();

    stubTaskModels(true);
    render(<TaskModelsPanel {...props} />);
    await waitFor(() => expect(screen.getByText("Change")).toBeTruthy());
    expect(screen.queryByText("Only an Admin can change this")).toBeNull();
  });
});
