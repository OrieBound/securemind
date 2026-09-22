// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InstanceSetupWizard } from "@/components/app/instance-setup-wizard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("setup storage by edition", () => {
  it.each([ ["local", "postgres", "Postgres + pgvector"], ["cloud", "dynamodb", "DynamoDB"] ] as const)(
    "%s shows only its store and submits it after acknowledgment",
    async (edition, backend, label) => {
      const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
      vi.stubGlobal("fetch", fetch);
      const onDone = vi.fn();
      render(<InstanceSetupWizard edition={edition} onDone={onDone} />);
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
      if (edition === "local") expect(screen.queryByText(/DynamoDB/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect((screen.getByRole("button", { name: "Finish setup" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
      await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ storageBackend: backend, riskAck: true });
    },
  );
});
