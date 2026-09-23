import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";
import SettingsPage from "./SettingsPage";

describe("settings page", () => {
  it("keeps credential mutation disabled until the CSRF session is ready", () => {
    render(<SettingsPage status={{apiKeyConfigured: false, workspaceConfigured: false}} ready={false} onSave={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole("button", {name: "正在建立安全会话…"})).toBeDisabled();
  });

  it("saves credentials without rendering their values afterward", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <SettingsPage
        status={{apiKeyConfigured: false, workspaceConfigured: false}}
        onSave={save}
        onClear={vi.fn()}
      />
    );
    await user.type(screen.getByLabelText("API Key"), "secret-api-key");
    await user.type(screen.getByLabelText("Workspace ID"), "workspace-secret");
    await user.click(screen.getByRole("button", {name: "保存到 macOS 钥匙串"}));
    expect(save).toHaveBeenCalledWith("secret-api-key", "workspace-secret");
    expect(screen.queryByDisplayValue("secret-api-key")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("workspace-secret")).not.toBeInTheDocument();
  });
});
