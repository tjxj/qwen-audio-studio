import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";
import SettingsPage from "./SettingsPage";
import {ApiError, getSettings, patchSettings} from "../../api";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    ApiError: actual.ApiError,
    getSettings: vi.fn(),
    patchCredentials: vi.fn().mockResolvedValue(undefined),
    deleteCredentials: vi.fn().mockResolvedValue(undefined),
    patchSettings: vi.fn().mockResolvedValue({
      revision: 2,
      script_font: "sans",
      script_font_size: 16,
      max_workers: 2,
      default_directory_id: null,
      default_params: {},
      theme: "dark"
    }),
    getDiagnostics: vi.fn().mockResolvedValue({
      checked_at: "2026-09-23T00:00:00+00:00",
      tools: {
        ffmpeg: {available: true, path: "/usr/bin/ffmpeg", version: "ffmpeg 7"},
        ffprobe: {available: true, path: "/usr/bin/ffprobe", version: "ffprobe 7"}
      },
      credentials: {api_key_configured: true, workspace_configured: true},
      storage: {data_root_writable: true, database_ready: true},
      model: {id: "qwen-audio-3.1-tts-next", authorisation_checked: false},
      not_checked: ["百炼账号是否已开通该模型"],
      note: "本地检查只确认依赖与配置。"
    })
  };
});

const unconfigured = {apiKeyConfigured: false, workspaceConfigured: false};

function renderPage(overrides: Record<string, unknown> = {}) {
  return render(
    <SettingsPage
      status={unconfigured}
      ready
      refreshStatus={vi.fn()}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.mocked(patchSettings).mockClear();
  vi.mocked(getSettings).mockResolvedValue({
    revision: 1,
    default_directory_id: null,
    default_params: {format: "wav", sample_rate: 48000, channels: 2},
    script_font: "serif",
    script_font_size: 16,
    max_workers: 2,
    theme: "system"
  });
});

describe("settings page", () => {
  it("keeps credential mutation disabled until the CSRF session is ready", () => {
    renderPage({ready: false});
    for (const button of screen.getAllByRole("button", {name: /^保存/})) {
      expect(button).toBeDisabled();
    }
  });

  it("saves only the workspace id and never echoes the value back", async () => {
    const {patchCredentials} = await import("../../api");
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("业务空间 ID（Workspace ID）"), "workspace-secret");
    await user.click(screen.getByRole("button", {name: "保存业务空间 ID"}));

    await waitFor(() => expect(patchCredentials).toHaveBeenCalledTimes(1));
    expect(patchCredentials).toHaveBeenCalledWith({workspaceId: "workspace-secret"});
    expect(screen.queryByDisplayValue("workspace-secret")).not.toBeInTheDocument();
    expect(screen.getByText("已写入 macOS 钥匙串。")).toBeVisible();
  });

  it("keeps an already configured key out of the input value", () => {
    renderPage({
      status: {apiKeyConfigured: true, workspaceConfigured: true}
    });
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "placeholder",
      "留空表示不修改"
    );
    expect(screen.getAllByText("已配置").length).toBeGreaterThan(0);
  });

  it("refuses to clear credentials without an explicit confirmation", async () => {
    const {deleteCredentials} = await import("../../api");
    const user = userEvent.setup();
    renderPage({status: {apiKeyConfigured: true, workspaceConfigured: false}});

    await user.click(screen.getByRole("button", {name: /清除凭据/}));
    expect(deleteCredentials).not.toHaveBeenCalled();
    expect(screen.getByText("确认清除已保存凭据？")).toBeVisible();

    await user.click(screen.getByRole("button", {name: "确认清除"}));
    await waitFor(() => expect(deleteCredentials).toHaveBeenCalledWith("all"));
  });

  it("toggles visibility of a value being typed", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText("API Key");
    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", {name: "显示API Key"}));
    expect(input).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", {name: "隐藏API Key"}));
    expect(input).toHaveAttribute("type", "password");
  });

  it("reports a keychain failure in readable Chinese without leaking the value", async () => {
    const {patchCredentials} = await import("../../api");
    vi.mocked(patchCredentials).mockRejectedValueOnce(
      new ApiError("凭据未能完整保存，已恢复为原来的值。", {
        code: "KEYCHAIN_UNAVAILABLE",
        status: 503
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("API Key"), "test-key-abcd1234");
    await user.click(screen.getByRole("button", {name: "保存API Key"}));

    await waitFor(() =>
      expect(
        screen.getByText("凭据未能完整保存，已恢复为原来的值。")
      ).toBeVisible()
    );
    expect(screen.getByLabelText("API Key")).toHaveValue("test-key-abcd1234");
  });

  it("runs the local check and states what it did not verify", async () => {
    const {getDiagnostics} = await import("../../api");
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", {name: /运行本地检查/}));
    await waitFor(() => expect(getDiagnostics).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/ffmpeg 可用/)).toBeVisible();
    expect(screen.getByText(/未检查：/)).toBeVisible();
  });

  it("applies the theme immediately and persists the choice", async () => {
    const {patchSettings} = await import("../../api");
    const user = userEvent.setup();
    document.documentElement.removeAttribute("data-theme");
    renderPage();
    await user.selectOptions(screen.getByLabelText("主题"), "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
    expect(vi.mocked(patchSettings).mock.calls[0][0]).toMatchObject({
      expected_revision: 1,
      theme: "dark"
    });
  });

  it("keeps the system preference resolved against the OS setting", async () => {
    const {applyTheme, resolveTheme} = await import("../../theme");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    applyTheme("system");
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(["light", "dark"]).toContain(document.documentElement.dataset.theme);
  });

  it("saves appearance preferences with the revision it loaded", async () => {
    const {patchSettings} = await import("../../api");
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText("脚本字体"), "sans");
    await user.click(screen.getByRole("button", {name: "保存外观设置"}));
    await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
    expect(vi.mocked(patchSettings).mock.calls[0][0]).toMatchObject({
      expected_revision: 1,
      script_font: "sans",
      max_workers: 2
    });
  });
});
