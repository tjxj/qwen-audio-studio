import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it} from "vitest";
import {MemoryRouter} from "react-router-dom";
import ProjectsPage from "./ProjectsPage";
import {DEFAULT_PARAMS, type Project} from "../../types";

function fixture(overrides: Partial<Project>): Project {
  return {
    prompt: "",
    params: DEFAULT_PARAMS,
    referenceBindings: [],
    templateApplication: null,
    outputDirectoryId: null,
    revision: 1,
    createdAt: "",
    updatedAt: "",
    archived: false,
    ...overrides
  } as Project;
}

describe("projects page", () => {
  it("shows a useful empty state", () => {
    render(<MemoryRouter><ProjectsPage projects={[]} /></MemoryRouter>);
    expect(screen.getByText("还没有项目")).toBeVisible();
    expect(screen.getByRole("link", {name: "创建第一个声音场景"})).toHaveAttribute("href", "/");
  });

  it("filters projects by name", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter><ProjectsPage
        projects={[
          fixture({id: "1", name: "雨夜播客", mode: "podcast", prompt: ""}),
          fixture({id: "2", name: "科技广告", mode: "advertisement", prompt: ""})
        ]}
      /></MemoryRouter>
    );
    await user.type(screen.getByLabelText("搜索项目"), "雨夜");
    expect(screen.getByText("雨夜播客")).toBeVisible();
    expect(screen.queryByText("科技广告")).not.toBeInTheDocument();
  });
});
