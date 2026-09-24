import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_DELAY_MS,
  recoveryKey,
  useProjectDraft,
  type ProjectDraftController,
} from "./useProjectDraft";
import { DEFAULT_PARAMS, type Project } from "../../types";

let controller: ProjectDraftController;
const calls: { method: string; url: string; body: any }[] = [];

function Harness(props: {
  projectId: string | null;
  loaded?: Project;
  onProjectCreated?: (id: string) => void;
}) {
  controller = useProjectDraft(props);
  return (
    <div>
      <span data-testid="state">{controller.state}</span>
      <span data-testid="message">{controller.message}</span>
      <button type="button" onClick={() => void controller.saveNow()}>
        立即保存
      </button>
      <button
        type="button"
        onClick={() => controller.change({ prompt: "手打的字" })}
      >
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
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function draftResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    id: "proj_1",
    name: "雨夜陪伴",
    mode: "podcast",
    prompt: "手打的字",
    params: { format: "wav", sample_rate: 48000, channels: 2 },
    reference_bindings: [],
    template_application: null,
    output_directory_id: null,
    revision: 5,
    archived: false,
    final_job_id: null,
    created_at: "2026-09-23T01:00:00+00:00",
    updated_at: "2026-09-23T02:00:00+00:00",
    ...overrides,
  });
}

function stub(
  handler: (init: any, url: string) => Response | Promise<Response>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      if (url === "/api/session") {
        return jsonResponse({
          csrf_token: "csrf-test",
          credentials: { api_key_configured: true, workspace_configured: true },
        });
      }
      calls.push({
        method: init.method || "GET",
        url,
        body: init.body ? JSON.parse(init.body) : null,
      });
      return handler(init, url);
    }),
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
  it("waits for the in-flight write and subsequent edits before immediate save resolves", async () => {
    let first: (value: Response) => void = () => undefined;
    let second: (value: Response) => void = () => undefined;
    const a = new Promise<Response>((resolve) => {
      first = resolve;
    });
    const b = new Promise<Response>((resolve) => {
      second = resolve;
    });
    let count = 0;
    stub(() => (++count === 1 ? a : b));
    render(<Harness projectId="proj_1" loaded={project()} />);
    let saved = false;
    let pending: Promise<boolean>;
    act(() => {
      controller.change({ prompt: "先写" });
      void controller.saveNow();
    });
    await flush();
    act(() => {
      controller.change({ prompt: "保存过程中又写" });
      pending = controller.saveNow().then((ok) => {
        saved = ok;
        return ok;
      });
    });
    await flush();
    expect(saved).toBe(false);
    await act(async () => {
      first(draftResponse({ revision: 5 }));
    });
    await flush();
    expect(saved).toBe(false);
    expect(
      JSON.parse(window.localStorage.getItem(recoveryKey("proj_1")) || "{}")
        .prompt,
    ).toBe("保存过程中又写");
    await act(async () => {
      second(draftResponse({ revision: 6 }));
      await pending;
    });
    expect(saved).toBe(true);
    expect(controller.revision).toBe(6);
    expect(
      calls
        .filter((call) => call.method === "PATCH")
        .map((call) => call.body.prompt),
    ).toEqual(["先写", "保存过程中又写"]);
  });

  it("defers new-project navigation until every queued edit is persisted", async () => {
    const created = vi.fn();
    let first: (value: Response) => void = () => undefined;
    let second: (value: Response) => void = () => undefined;
    const a = new Promise<Response>((resolve) => {
      first = resolve;
    });
    const b = new Promise<Response>((resolve) => {
      second = resolve;
    });
    let count = 0;
    stub(() => (++count === 1 ? a : b));
    render(<Harness projectId={null} onProjectCreated={created} />);
    act(() => {
      controller.change({ prompt: "创建时的文本" });
      void controller.saveNow();
    });
    await flush();
    act(() => controller.change({ prompt: "导航前追加的文本" }));
    await act(async () => {
      first(draftResponse({ id: "created", revision: 1 }));
    });
    await flush();
    expect(created).not.toHaveBeenCalled();
    expect(
      JSON.parse(window.localStorage.getItem(recoveryKey("created")) || "{}")
        .prompt,
    ).toBe("导航前追加的文本");
    await act(async () => {
      second(draftResponse({ id: "created", revision: 2 }));
    });
    await flush();
    expect(created).toHaveBeenCalledOnce();
    expect(created).toHaveBeenCalledWith("created");
    expect(window.localStorage.getItem(recoveryKey(null))).toBeNull();
  });

  it("returns the created identity to a caller holding the pre-save controller", async () => {
    stub(() => draftResponse({ id: "new-identity", revision: 1 }));
    render(<Harness projectId={null} />);
    const beforeSave = controller;
    await act(async () => {
      expect(await beforeSave.saveNow()).toBe(true);
    });
    expect(beforeSave.getIdentity()).toEqual({
      id: "new-identity",
      revision: 1,
    });
  });

  it("returns failure to every waiting caller if the queued update fails", async () => {
    let first: (value: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => {
      first = resolve;
    });
    let count = 0;
    stub(() =>
      ++count === 1 ? gate : Promise.reject(new TypeError("offline")),
    );
    render(<Harness projectId="proj_1" loaded={project()} />);
    let original: Promise<boolean>;
    let waiting: Promise<boolean>;
    act(() => {
      controller.change({ prompt: "已经提交" });
      original = controller.saveNow();
    });
    await flush();
    act(() => {
      controller.change({ prompt: "尚未存上" });
      waiting = controller.saveNow();
    });
    await act(async () => {
      first(draftResponse({ revision: 5 }));
      expect(await original).toBe(false);
      expect(await waiting).toBe(false);
    });
    expect(controller.state).toBe("failed");
    expect(
      JSON.parse(window.localStorage.getItem(recoveryKey("proj_1")) || "{}")
        .prompt,
    ).toBe("尚未存上");
  });

  it("keeps the copied draft name on the next autosave and removes the old recovery copy", async () => {
    stub((init, url) => {
      if (url.endsWith("/duplicate"))
        return draftResponse({
          id: "copy",
          revision: 1,
          name: "雨夜陪伴 副本",
        });
      return draftResponse({ id: "copy", revision: 2, name: "雨夜陪伴 副本" });
    });
    render(<Harness projectId="proj_1" loaded={project()} />);
    act(() => controller.change({ prompt: "仅本地修改" }));
    await act(async () => {
      await controller.resolveConflictByCopy();
    });
    expect(controller.fields.name).toBe("雨夜陪伴 副本");
    expect(window.localStorage.getItem(recoveryKey("proj_1"))).toBeNull();
    await act(async () => {
      controller.change({ prompt: "继续改副本" });
      await controller.saveNow();
    });
    expect(
      calls.filter((call) => call.method === "PATCH").at(-1)?.body.name,
    ).toBe("雨夜陪伴 副本");
  });

  it("holds immediate save behind copy creation instead of patching the previous project", async () => {
    let finish: (value: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    stub((init, url) =>
      url.endsWith("/duplicate")
        ? gate
        : draftResponse({ id: "copy", name: "雨夜陪伴 副本", revision: 2 }),
    );
    render(<Harness projectId="proj_1" loaded={project()} />);
    let copy: Promise<string | null>;
    let saving: Promise<boolean>;
    act(() => {
      copy = controller.resolveConflictByCopy();
    });
    await flush();
    act(() => {
      controller.change({ prompt: "副本进行时输入" });
      saving = controller.saveNow();
    });
    await flush();
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    await act(async () => {
      finish(draftResponse({ id: "copy", revision: 1 }));
      await copy;
      expect(await saving).toBe(true);
    });
    expect(
      calls
        .filter((call) => call.method === "PATCH")
        .every((call) => call.url === "/api/projects/copy"),
    ).toBe(true);
    expect(
      calls.filter((call) => call.method === "PATCH").at(-1)?.body.prompt,
    ).toBe("副本进行时输入");
  });

  it("does not discard typing that happens while the server copy is being reloaded", async () => {
    let finish: (value: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    stub(() => gate);
    render(<Harness projectId="proj_1" loaded={project()} />);
    let loading: Promise<void>;
    act(() => {
      loading = controller.resolveConflictByReload();
    });
    await flush();
    act(() => controller.change({ prompt: "读取期间新写的内容" }));
    await act(async () => {
      finish(draftResponse({ prompt: "远程版本", revision: 8 }));
      await loading;
    });
    expect(controller.fields.prompt).toBe("读取期间新写的内容");
    expect(controller.revision).toBe(4);
    expect(controller.state).toBe("conflict");
  });

  it("waits for a pause in typing before writing, then reports saved", async () => {
    vi.useFakeTimers();
    try {
      stub(() => draftResponse());
      render(<Harness projectId="proj_1" loaded={project()} />);

      act(() => controller.change({ prompt: "第一版" }));
      expect(screen.getByTestId("state")).toHaveTextContent("dirty");
      act(() => controller.change({ prompt: "第二版" }));
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
        return seen === 1
          ? gate
          : Promise.resolve(draftResponse({ revision: 6 }));
      });
      render(<Harness projectId="proj_1" loaded={project()} />);

      act(() => controller.change({ prompt: "甲" }));
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      });
      await flush();
      expect(screen.getByTestId("state")).toHaveTextContent("saving");

      act(() => controller.change({ prompt: "乙" }));
      release(draftResponse({ revision: 5 }));
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
      window.localStorage.getItem(recoveryKey("proj_1")) || "null",
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
              details: { current_revision: 9 },
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return draftResponse({ revision: 9 });
    });
    render(<Harness projectId="proj_1" loaded={project()} />);

    await act(async () => {
      await controller.saveNow();
    });
    expect(controller.conflict).toEqual({ serverRevision: 9 });
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
              details: { current_revision: 9 },
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      if (init.method === "POST" && url.endsWith("/duplicate")) {
        return draftResponse({ id: "proj_copy", revision: 1 });
      }
      return draftResponse({ id: "proj_copy", revision: 2 });
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
    expect(calls.map((call) => call.url)).toContain(
      "/api/projects/proj_1/duplicate",
    );
    expect(
      calls.find(
        (call) => call.method === "PATCH" && call.url.includes("proj_copy"),
      )?.body.prompt,
    ).toBe("服务器上的稿子");
    expect(controller.projectId).toBe("proj_copy");
  });

  it("creates a project the first time an unsaved draft is written", async () => {
    stub(() => draftResponse({ id: "proj_new", revision: 1 }));
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
        "templateApplication",
      ].sort(),
    );
  });

  it("saves immediately on Cmd+S", async () => {
    stub(() => draftResponse());
    render(<Harness projectId="proj_1" loaded={project()} />);
    await act(async () => {
      controller.change({ prompt: "快捷键保存" });
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", metaKey: true }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("saved"),
    );
    expect(calls.some((call) => call.method === "PATCH")).toBe(true);
  });

  it("keeps a failed brand-new draft recoverable under the unsaved key", async () => {
    stub(() => {
      throw new TypeError("offline");
    });
    const first = render(<Harness projectId={null} />);
    await act(async () => {
      controller.change({ prompt: "没网时写的稿子" });
      await controller.saveNow();
    });
    expect(screen.getByTestId("state")).toHaveTextContent("failed");
    expect(
      JSON.parse(window.localStorage.getItem(recoveryKey(null)) || "{}").prompt,
    ).toBe("没网时写的稿子");
    first.unmount();

    stub(() => draftResponse({ id: "proj_other", revision: 1 }));
    render(<Harness projectId={null} />);
    await waitFor(() => expect(controller.recovered).not.toBeNull());
    expect(controller.recovered?.prompt).toBe("没网时写的稿子");
  });

  it("clears the unsaved-draft copy once the brand-new project is created", async () => {
    vi.useFakeTimers();
    try {
      stub(() => draftResponse({ id: "proj_created", revision: 1 }));
      render(<Harness projectId={null} />);
      act(() => controller.change({ prompt: "第一行" }));
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
        templateApplication: null,
      }),
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
