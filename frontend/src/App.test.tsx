import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/health")
        return new Response(JSON.stringify({ status: "ok" }));
      if (url.pathname === "/api/session")
        return new Response(
          JSON.stringify({
            csrf_token: "test",
            credentials: {
              api_key_configured: false,
              workspace_configured: false,
            },
          }),
        );
      if (url.pathname === "/api/projects") return new Response("[]");
      if (url.pathname === "/api/settings")
        return new Response(
          JSON.stringify({
            revision: 1,
            script_font: "serif",
            script_font_size: 16,
            theme: "light",
            default_directory_id: null,
            default_params: {},
          }),
        );
      if (url.pathname.startsWith("/api/directories/"))
        return new Response(
          JSON.stringify({
            id: "dir_default",
            display_name: "音频作品",
            writable: true,
          }),
        );
      if (url.pathname === "/api/library")
        return new Response(
          JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
        );
      throw new Error("Unexpected test API: " + url.pathname);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("application shell", () => {
  it("renders the three primary destinations without redundant voice/history entries", async () => {
    renderApp("/");

    const navigation = screen.getByRole("navigation", { name: "主导航" });
    for (const label of ["创作台", "作品库", "灵感模板"]) {
      expect(
        within(navigation).getByRole("link", { name: label }),
      ).toBeVisible();
    }
    expect(within(navigation).getAllByRole("link")).toHaveLength(3);
    expect(
      screen.queryByRole("link", { name: "音色参考" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "生成历史" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toBeVisible();
    expect(screen.getByRole("link", { name: "帮助" })).toHaveAttribute(
      "href",
      "/help",
    );
    expect(await screen.findByText("本地服务已连接")).toBeVisible();
    expect(await screen.findByLabelText("场景提示词")).toBeVisible();
  });

  it("redirects old history URLs into the selected library destination", async () => {
    renderApp("/history");
    expect(await screen.findByRole("link", { name: "作品库" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
