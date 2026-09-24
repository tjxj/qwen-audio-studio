import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import CreatePage from "./CreatePage";
import {
  createProject,
  getProject,
  getSettings,
  listProjects,
} from "../../api";
import { DEFAULT_PARAMS, type Project } from "../../types";

vi.mock("../../api", async () => ({
  ...(await vi.importActual<typeof import("../../api")>("../../api")),
  getSession: vi.fn(async () => ({
    csrf_token: "test",
    credentials: { api_key_configured: true, workspace_configured: true },
  })),
  getSettings: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  request: vi.fn(async () => ({
    id: "dir_custom",
    display_name: "测试输出",
    writable: true,
  })),
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(getSettings).mockResolvedValue({
    revision: 4,
    default_directory_id: "dir_custom",
    default_params: {
      format: "mp3",
      sample_rate: 24000,
      channels: 1,
      rate: 1.2,
      seed: 81,
    },
    script_font: "serif",
    script_font_size: 16,
    max_workers: 2,
    theme: "light",
  });
  vi.mocked(listProjects).mockResolvedValue([]);
  let count = 0;
  const projects = new Map<string, Project>();
  vi.mocked(createProject).mockImplementation(async (fields) => {
    const id = "project_" + ++count;
    const project = {
      name: "测试",
      mode: "podcast",
      prompt: "",
      params: DEFAULT_PARAMS,
      referenceBindings: [],
      templateApplication: null,
      outputDirectoryId: null,
      createdAt: "",
      updatedAt: "",
      archived: false,
      ...fields,
      id,
      revision: 1,
    } as Project;
    projects.set(id, project);
    return project;
  });
  vi.mocked(getProject).mockImplementation(async (id) => projects.get(id)!);
});
function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("新编辑器首次显示就采用完整默认参数，不在用户编辑后异步覆盖", async () => {
  mount();
  expect(await screen.findByLabelText("输出格式")).toHaveValue("mp3");
  expect(screen.getByLabelText("采样率")).toHaveValue("24000");
  expect(await screen.findByText("测试输出")).toBeVisible();
});

test("菜单创建空白草稿也带上当前保存的默认参数和目录", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "更多草稿操作" }));
  await user.click(screen.getByRole("button", { name: "空白草稿" }));
  await waitFor(() => expect(createProject).toHaveBeenCalledTimes(2));
  expect(vi.mocked(createProject).mock.calls[1][0]).toMatchObject({
    prompt: "",
    params: {
      format: "mp3",
      sampleRate: 24000,
      channels: 1,
      rate: 1.2,
      seed: 81,
    },
    outputDirectoryId: "dir_custom",
  });
  expect(await screen.findByLabelText("场景提示词")).toHaveValue("");
});
