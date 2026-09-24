import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import CreateWorkbench from "./CreateWorkbench";

describe("compact creation workflow", () => {
  it('removes the redundant mode description and project-creation wording', () => {
    render(<CreateWorkbench credentialsReady onSubmit={vi.fn()} onJobCreated={vi.fn()}/>);
    expect(screen.queryByText('当前工作流')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading',{name:'播客创作'})).not.toBeInTheDocument();
    expect(screen.queryByText('自然对谈与稳定声场',{exact:false})).not.toBeInTheDocument();
    expect(screen.queryByText('新建项目')).not.toBeInTheDocument();
  });
  it("keeps the new draft action behind a quiet menu and preserves a hand edit across modes", () => {
    render(
      <CreateWorkbench
        credentialsReady
        onSubmit={vi.fn()}
        onJobCreated={vi.fn()}
        onNewProject={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "新建项目" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("场景提示词"), {
      target: { value: "自己的创作" },
    });
    fireEvent.click(screen.getByRole("button", { name: "广告" }));
    expect(screen.getByLabelText("场景提示词")).toHaveValue("自己的创作");
  });
  it("requires an explicit cost confirmation for even a text-only generation", () => {
    const submit = vi.fn();
    render(
      <CreateWorkbench
        credentialsReady
        onSubmit={submit}
        onJobCreated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "生成音频" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认生成" })).toBeVisible();
  });
});
