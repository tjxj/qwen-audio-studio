import {render, screen} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {describe, expect, it} from "vitest";
import App from "./App";

function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}}
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("application shell", () => {
  it("renders exact primary navigation and local status", () => {
    renderApp("/");

    for (const label of ["创作台", "项目", "音色参考", "生成历史", "设置"]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getByText("Qwen Audio Studio")).toBeVisible();
    expect(screen.getByText("本地 · 正在连接")).toBeVisible();
  });

  it("marks the current route as selected", () => {
    renderApp("/history");
    expect(screen.getByRole("link", {name: "生成历史"})).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});
