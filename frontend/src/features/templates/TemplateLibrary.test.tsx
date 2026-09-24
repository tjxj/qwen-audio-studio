import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { TemplateLibrary } from "./TemplateLibrary";
import type { StudioTemplate } from "./templatesApi";

const item: StudioTemplate = {
  id: "coffee-ad",
  source: "builtin",
  version: 2,
  name: "咖啡门店",
  mode: "advertisement",
  description: "一杯热咖啡",
  tags: ["单人"],
  role_count: 1,
  suggested_duration_seconds: 25,
  prompt_pattern: "来{{brand}}坐坐",
  variables: [
    {
      key: "brand",
      label: "门店名称",
      type: "text",
      required: true,
      default: "木雀",
      max_length: 80,
    },
  ],
  params_preset: null,
  favorite: false,
};
let favorited = false;
let userTemplates: StudioTemplate[] = [];
beforeEach(() => {
  favorited = false;
  userTemplates = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/api/session")
        return new Response(JSON.stringify({ csrf_token: "test" }));
      if (path.endsWith("/preview")) {
        const { values } = JSON.parse(String(options?.body));
        if (!values.brand)
          return new Response(
            JSON.stringify({
              error: { code: "INVALID_TEMPLATE", message: "请填写门店名称。" },
            }),
            { status: 422 },
          );
        return new Response(
          JSON.stringify({
            prompt: `来${values.brand}坐坐`,
            compiled_prompt: `模式：来${values.brand}坐坐`,
            compiled_chars: 10,
            max_chars: 3000,
            values,
            missing_roles: [],
            can_apply: true,
            params_preset: null,
            params_diff: {},
          }),
        );
      }
      if (path.endsWith("/favorite")) {
        favorited = JSON.parse(String(options?.body)).favorite;
        return new Response(JSON.stringify({ ...item, favorite: favorited }));
      }
      if (path === "/api/templates" && options?.method === "POST") {
        const created = {
          ...JSON.parse(String(options.body)),
          id: "template_test",
          source: "user",
          version: 1,
          favorite: false,
        };
        userTemplates.push(created);
        return new Response(JSON.stringify(created), { status: 201 });
      }
      if (
        path === "/api/templates/template_test" &&
        options?.method === "PATCH"
      ) {
        userTemplates[0] = {
          ...userTemplates[0],
          ...JSON.parse(String(options.body)),
          version: userTemplates[0].version + 1,
        };
        return new Response(JSON.stringify(userTemplates[0]));
      }
      if (
        path === "/api/templates/template_test" &&
        options?.method === "DELETE"
      ) {
        userTemplates = [];
        return new Response(null, { status: 204 });
      }
      const items = path.includes("source=user")
        ? userTemplates
        : [{ ...item, favorite: favorited }, ...userTemplates];
      return new Response(
        JSON.stringify({ items, total: items.length, page: 1, page_size: 50 }),
      );
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
function mount(onApply = vi.fn(), currentPrompt = "") {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <MemoryRouter>
        <TemplateLibrary currentPrompt={currentPrompt} onApply={onApply} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onApply;
}

test("填写变量后预览真实文本，现有文案覆盖需再次确认", async () => {
  const apply = mount(vi.fn(), "原有脚本");
  const user = userEvent.setup();
  const input = await screen.findByLabelText("门店名称");
  await user.clear(input);
  await user.type(input, "小岛");
  await screen.findByText("来小岛坐坐");
  await user.click(screen.getByRole("button", { name: "应用到创作台" }));
  expect(apply).not.toHaveBeenCalled();
  const confirm = screen.getByRole("dialog", { name: "替换当前文案？" });
  await user.click(within(confirm).getByRole("button", { name: "确认替换" }));
  await waitFor(() =>
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "来小岛坐坐", mode: "advertisement" }),
    ),
  );
});

test("收藏按钮仅改变收藏，不触发应用或生成", async () => {
  const apply = mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "收藏咖啡门店" }));
  await screen.findByRole("button", { name: "取消收藏咖啡门店" });
  expect(apply).not.toHaveBeenCalled();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("/generation")),
  ).toBe(false);
});

test("缺少必填变量时呈现服务端错误并禁用应用", async () => {
  const apply = mount();
  const user = userEvent.setup();
  await user.clear(await screen.findByLabelText("门店名称"));
  expect(await screen.findByRole("alert")).toHaveTextContent("请填写门店名称");
  expect(screen.getByRole("button", { name: "应用到创作台" })).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
});

test("复制内置模板后可编辑并删除自建副本，不修改原模板", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "复制为自建" }));
  const creator = screen.getByRole("dialog", { name: "创建自己的模板" });
  await user.clear(within(creator).getByLabelText("模板名称"));
  await user.type(within(creator).getByLabelText("模板名称"), "周末门店");
  await user.click(within(creator).getByRole("button", { name: "保存模板" }));
  await screen.findByRole("button", { name: "预览周末门店" });
  await user.click(screen.getByRole("button", { name: "编辑" }));
  const editor = screen.getByRole("dialog", { name: "编辑自建模板" });
  await user.type(within(editor).getByLabelText("模板名称"), "二稿");
  await user.click(within(editor).getByRole("button", { name: "保存模板" }));
  await screen.findByRole("button", { name: "预览周末门店二稿" });
  await user.click(screen.getByRole("button", { name: "删除" }));
  expect(userTemplates).toHaveLength(1);
  const confirmation = screen.getByRole("dialog", { name: "删除自建模板？" });
  await user.click(
    within(confirmation).getByRole("button", { name: "确认删除" }),
  );
  await screen.findByText("这里还没有模板");
  await user.selectOptions(screen.getByLabelText("模板来源"), "");
  expect(
    await screen.findByRole("button", { name: "预览咖啡门店" }),
  ).toBeVisible();
  expect(item.name).toBe("咖啡门店");
});
