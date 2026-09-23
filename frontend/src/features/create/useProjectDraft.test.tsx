import {act, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {
  AUTOSAVE_DELAY_MS,
  recoveryKey,
  useProjectDraft,
  type ProjectDraftController
} from "./useProjectDraft";
import {DEFAULT_PARAMS, type Project} from "../../types";

let controller: ProjectDraftController;
const calls: {method: string; url: string; body: any}[] = [];

function Harness(props: {projectId: string | null; loaded?: Project}) {
  controller = useProjectDraft({...props, onProjectCreated: vi.fn()});
  return (
    <div>
      <span data-testid="state">{controller.state}</span>
      <span data-testid="message">{controller.message}</span>
      <button type="button" onClick={() => void controller.saveNow()}>
        立即保存
      </button>
      <button type="button" onClick={() => controller.change({prompt: "手打的字"})}>
        编辑
      </button>
    </div>
  );
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj_1",
    name: "雨夜陪伴",
    mode: "podcast",
    prompt: "服务器上的稿子",
    params: DEFAULT_PARAMS,
    referenceBindings: [],
    templateApplication: null,
    outputDirectoryId: null,
    revision: 4,
    createdAt: "2026-09-23T01:00:00+00:00",
    updatedAt: "2026-09-23T01:00:00+00:00",
    archived: false,
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"Content-Type": "application/json"}
  });
}

function draftResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    id: "proj_1",
    name: "雨夜陪伴",
    mode: "podcast",
    prompt: "手打的字",
    params: {format: "wav", sample_rate: 48000, channels: 2},
    reference_bindings: [],
    template_application: null,
    output_directory_id: null,
    revision: 5,
    archived: false,
    final_job_id: null,
    created_at: "2026-09-23T01:00:00+00:00",
    updated_at: "2026-09-23T02:00:00+00:00",
    ...overrides
  });
}

function stub(handler: (init: any, url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      if (url === "/api/session") {
        return jsonResponse({
          csrf_token: "csrf-test",
          credentials: {api_key_configured: true, workspace_configured: true}
        });
      }
      calls.push({
        method: init.method || "GET",
        url,
        body: init.body ? JSON.parse(init.body) : null
      });
      return handler(init, url);
    })
  );
}

beforeEach(() => {
  calls.length = 0;
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function flush(ticks = 12) {
  await act(async () => {
    for (let index = 0; index < ticks; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("project draft autosave", () => {
  it("waits for a pause in typing before writing, then reports saved", async () => {
    vi.useFakeTimers();
    try {
      stub(() => draftResponse());
      render(<Harness projectId="proj_1" loaded={project()} />);

      act(() => controller.change({prompt: "第一版"}));
      expect(screen.getByTestId("state")).toHaveTextContent("dirty");
      act(() => controller.change({prompt: "第二版"}));
      expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      });
      await flush();

      expect(screen.getByTestId("state")).toHaveTextContent("saved");
      const writes = calls.filter((call) => call.method === "PATCH");
      expect(writes).toHaveLength(1);
      expect(writes[0].body.prompt).toBe("第二版");
      expect(writes[0].body.expected_revision).toBe(4);
      expect(writes[0].url).toBe("/api/projects/proj_1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends only one request while a save is already running and reuses the new revision", async () => {
    vi.useFakeTimers();
    let release: (value: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let seen = 0;
    try {
      stub(() => {
        seen += 1;
        return seen === 1 ? gate : Promise.resolve(draftResponse({revision: 6}));
      });
      render(<Harness projectId="proj_1" loaded={project()} />);

      act(() => controller.change({prompt: "甲"}));
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      });
      await flush();
      expect(screen.getByTestId("state")).toHaveTextContent("saving");

      act(() => controller.change({prompt: "乙"}));
      release(draftResponse({revision: 5}));
      await flush();
      expect(screen.getByTestId("state")).toHaveTextContent("saved");

      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 10);
      });
      await flush();

      const writes = calls.filter((call) => call.method === "PATCH");
      expect(writes.map((call) => call.body.expected_revision)).toEqual([4, 5]);
      expect(writes.map((call) => call.body.prompt)).toEqual(["甲", "乙"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an uncommitted local copy when the server write fails", async () => {
    stub(() => {
      throw new TypeError("Failed to fetch");
    });
    render(<Harness projectId="proj_1" loaded={project()} />);

    await act(async () => {
      await controller.saveNow();
    });
    expect(screen.getByTestId("state")).toHaveTextContent("failed");
    const copy = JSON.parse(
      window.localStorage.getItem(recoveryKey("proj_1")) || "null"
    );
    expect(copy.prompt).toBe("服务器上的稿子");
  });

  it("surfaces a revision conflict without overwriting the server copy", async () => {
    stub((init) => {
      if (init.method === "PATCH") {
        return new Response(
          JSON.stringify({
            error: {
              code: "REVISION_CONFLICT",
              message: "项目已被修改",
              field: "expected_revision",
              retryable: false,
              details: {current_revision: 9}
            }
          }),
          {status: 409, headers: {"Content-Type": "application/json"}}
        );
      }
      return draftResponse({revision: 9});
    });
    render(<Harness projectId="proj_1" loaded={project()} />);

    await act(async () => {
      await controller.saveNow();
    });
    expect(controller.conflict).toEqual({serverRevision: 9});
    expect(screen.getByTestId("state")).toHaveTextContent("conflict");
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(window.localStorage.getItem(recoveryKey("proj_1"))).not.toBeNull();
  });

  it("resolves a conflict by saving a copy instead of clobbering", async () => {
    let patched = false;
    stub((init, url) => {
      if (init.method === "PATCH" && !patched) {
        patched = true;
        return new Response(
          JSON.stringify({
            error: {
              code: "REVISION_CONFLICT",
              message: "项目已被修改",
              field: "expected_revision",
              retryable: false,
              details: {current_revision: 9}
            }
          }),
          {status: 409, headers: {"Content-Type": "application/json"}}
        );
      }
      if (init.method === "POST" && url.endsWith("/duplicate")) {
        return draftResponse({id: "proj_copy", revision: 1});
      }
      return draftResponse({id: "proj_copy", revision: 2});
    });
    render(<Harness projectId="proj_1" loaded={project()} />);

    await act(async () => {
      await controller.saveNow();
    });
    let copyId: string | null = null;
    await act(async () => {
      copyId = await controller.resolveConflictByCopy();
    });
    expect(copyId).toBe("proj_copy");
    expect(calls.map((call) => call.url)).toContain("/api/projects/proj_1/duplicate");
    expect(
      calls.find((call) => call.method === "PATCH" && call.url.includes("proj_copy"))
        ?.body.prompt
    ).toBe("服务器上的稿子");
    expect(controller.projectId).toBe("proj_copy");
  });

  it("creates a project the first time an unsaved draft is written", async () => {
    stub(() => draftResponse({id: "proj_new", revision: 1}));
    render(<Harness projectId={null} />);

    await act(async () => {
      await controller.saveNow();
    });
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe("/api/projects");
    expect(controller.projectId).toBe("proj_new");
    expect(screen.getByTestId("state")).toHaveTextContent("saved");
  });

  it("stores no credential material in the recovery copy", async () => {
    stub(() => {
      throw new TypeError("offline");
    });
    render(<Harness projectId="proj_1" loaded={project()} />);
    await act(async () => {
      await controller.saveNow();
    });
    const raw = window.localStorage.getItem(recoveryKey("proj_1")) || "";
    expect(raw).not.toMatch(/api_key|authorization|token|base64/i);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(
      [
        "mode",
        "name",
        "outputDirectoryId",
        "params",
        "prompt",
        "referenceBindings",
        "templateApplication"
      ].sort()
    );
  });

  it("saves immediately on Cmd+S", async () => {
    stub(() => draftResponse());
    render(<Harness projectId="proj_1" loaded={project()} />);
    await act(async () => {
      controller.change({prompt: "快捷键保存"});
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {key: "s", metaKey: true})
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("saved")
    );
    expect(calls.some((call) => call.method === "PATCH")).toBe(true);
  });

  it("keeps a failed brand-new draft recoverable under the unsaved key", async () => {
    stub(() => {
      throw new TypeError("offline");
    });
    const first = render(<Harness projectId={null} />);
    await act(async () => {
      controller.change({prompt: "没网时写的稿子"});
      await controller.saveNow();
    });
    expect(screen.getByTestId("state")).toHaveTextContent("failed");
    expect(
      JSON.parse(window.localStorage.getItem(recoveryKey(null)) || "{}").prompt
    ).toBe("没网时写的稿子");
    first.unmount();

    stub(() => draftResponse({id: "proj_other", revision: 1}));
    render(<Harness projectId={null} />);
    await waitFor(() => expect(controller.recovered).not.toBeNull());
    expect(controller.recovered?.prompt).toBe("没网时写的稿子");
  });

  it("clears the unsaved-draft copy once the brand-new project is created", async () => {
    vi.useFakeTimers();
    try {
      stub(() => draftResponse({id: "proj_created", revision: 1}));
      render(<Harness projectId={null} />);
      act(() => controller.change({prompt: "第一行"}));
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      });
      await flush(20);
      expect(controller.projectId).toBe("proj_created");
      expect(window.localStorage.getItem(recoveryKey(null))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers the older local copy for recovery after a reload", async () => {
    window.localStorage.setItem(
      recoveryKey("proj_1"),
      JSON.stringify({
        name: "雨夜陪伴",
        mode: "podcast",
        prompt: "刷新前没存上的稿子",
        params: DEFAULT_PARAMS,
        referenceBindings: [],
        outputDirectoryId: null,
        templateApplication: null
      })
    );
    stub(() => draftResponse());
    render(<Harness projectId="proj_1" loaded={project()} />);

    await waitFor(() => expect(controller.recovered).not.toBeNull());
    expect(controller.recovered?.prompt).toBe("刷新前没存上的稿子");

    act(() => {
      controller.applyRecovered();
    });
    expect(controller.fields.prompt).toBe("刷新前没存上的稿子");
    expect(screen.getByTestId("state")).toHaveTextContent("dirty");

    act(() => {
      controller.dismissRecovered();
    });
    expect(controller.recovered).toBeNull();
    expect(window.localStorage.getItem(recoveryKey("proj_1"))).toBeNull();
  });
});
