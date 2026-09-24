import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// The configured server owns a fresh mkdtemp data root and synthetic audio only.
// No real credentials, personal samples, or chargeable provider calls are used.
async function api(
  request: APIRequestContext,
  method: string,
  path: string,
  body?: unknown,
) {
  const session = await (await request.get("/api/session")).json();
  const response = await request.fetch(path, {
    method,
    headers: { "X-Qwen-Studio-CSRF": session.csrf_token },
    ...(body === undefined ? {} : { data: body }),
  });
  expect(
    response.ok(),
    `${method} ${path}: ${await response.text()}`,
  ).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function project(
  request: APIRequestContext,
  name: string,
  prompt = "【角色：旁白（自然温和）】\n【对白：旁白】今晚，给自己留一点安静的时间。",
) {
  return api(request, "POST", "/api/projects", {
    name,
    mode: "podcast",
    prompt,
    params: { format: "wav", sample_rate: 48000, channels: 2, seed: 42 },
  });
}
async function goProject(page: Page, id: string) {
  await page.goto("/?project=" + id);
  await expect(page.getByLabel("场景提示词")).toBeVisible();
}
async function settled(page: Page) {
  await expect(page.getByTestId("save-state")).toHaveText("已保存");
}
function wavBuffer(seconds = 40) {
  const rate = 16000,
    bytes = seconds * rate * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(bytes, 40);
  for (let sample = 0; sample < bytes / 2; sample++)
    wav.writeInt16LE(
      Math.round(2400 * Math.sin((2 * Math.PI * 280 * sample) / rate)),
      44 + sample * 2,
    );
  return wav;
}

test("草稿自动保存、刷新恢复，七种模式切换保留手写内容", async ({
  page,
  request,
}) => {
  const draft = await project(request, "验收 · 自动保存");
  await goProject(page, draft.id);
  const editor = page.getByLabel("场景提示词");
  const text = "【对白：旁白】这段手写文案需要在切换模式和刷新之后完整保留。";
  await editor.fill(text);
  for (const label of [
    "广告",
    "有声书",
    "广播剧",
    "游戏配音",
    "旁白",
    "自定义",
    "播客",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(editor).toHaveValue(text);
  }
  await settled(page);
  await page.reload();
  await expect(editor).toHaveValue(text);
  const saved = await api(request, "GET", "/api/projects/" + draft.id);
  expect(saved.prompt).toBe(text);
  expect(saved.mode).toBe("podcast");
  expect(saved.revision).toBeGreaterThan(1);
  await expect(page.getByRole("button", { name: "新建空白草稿" })).toHaveCount(
    0,
  );
});

test("模板变量经真实后端预览、确认覆盖，并能一键撤销", async ({
  page,
  request,
}) => {
  const original = "这是需要完整恢复的原始手稿。";
  const draft = await project(request, "验收 · 模板撤销", original);
  await goProject(page, draft.id);
  await page.getByRole("button", { name: "广告", exact: true }).click();
  await page.getByRole("button", { name: "咖啡门店", exact: true }).click();
  const library = page.getByRole("dialog", { name: "灵感模板", exact: true });
  await expect(library).toBeVisible();
  await library.getByRole("button", { name: "预览咖啡门店" }).click();
  await library.getByLabel("门店名称").fill("岸边小店");
  await expect(library.locator(".tpl-script")).toContainText("岸边小店");
  await library.getByRole("button", { name: "应用到创作台" }).click();
  const confirmation = page.getByRole("dialog", { name: "替换当前文案？" });
  await expect(page.getByLabel("场景提示词")).toHaveValue(original);
  await confirmation.getByRole("button", { name: "确认替换" }).click();
  await expect(page.getByLabel("场景提示词")).toHaveValue(/岸边小店/);
  await page.getByRole("button", { name: "撤销应用模板" }).click();
  await expect(page.getByLabel("场景提示词")).toHaveValue(original);
  await settled(page);
});

test("设置分组、默认参数保存，并应用于新草稿", async ({ page, request }) => {
  const original = await api(request, "GET", "/api/settings");
  await page.goto("/settings");
  await expect(page.getByLabel("业务空间 ID（Workspace ID）")).toBeVisible();
  await expect(page.getByLabel("主题")).toBeHidden();
  await page.getByRole("tab", { name: "外观", exact: true }).click();
  await expect(page.getByLabel("主题")).toBeVisible();
  await expect(page.getByLabel("API Key", { exact: true })).toBeHidden();
  await page.getByRole("tab", { name: "文件与存储" }).click();
  await page.getByRole("button", { name: "编辑默认参数" }).click();
  const dialog = page.getByRole("dialog", { name: "默认输出参数" });
  await dialog.getByLabel("输出格式").selectOption("mp3");
  await dialog.getByLabel("采样率").selectOption("24000");
  await dialog.getByLabel("随机种子").fill("81");
  await dialog.getByRole("button", { name: "保存默认参数" }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await api(request, "GET", "/api/settings");
  expect(saved.default_params).toMatchObject({
    format: "mp3",
    sample_rate: 24000,
    seed: 81,
  });
  await page.getByRole("link", { name: "创作台", exact: true }).click();
  await page.getByRole("button", { name: "更多草稿操作" }).click();
  await page.getByRole("button", { name: "新建空白草稿" }).click();
  await expect(page.getByLabel("场景提示词")).toHaveValue("");
  await expect(page.getByLabel("输出格式")).toHaveValue("mp3");
  await expect(page.getByLabel("采样率")).toHaveValue("24000");
  const current = await api(request, "GET", "/api/settings");
  await api(request, "PATCH", "/api/settings", {
    expected_revision: current.revision,
    default_params: original.default_params,
  });
});

test("作品库可筛选、改名收藏、两种回收与恢复，文件行为符合选择", async ({
  page,
  request,
}) => {
  const all = await api(
    request,
    "GET",
    "/api/library?view=jobs&status=success&page_size=50",
  );
  const job = all.items.find((item: { can_play: boolean }) => item.can_play);
  expect(job).toBeTruthy();
  const title = "验收 · 可恢复的声音";
  await page.goto("/library?view=jobs");
  await page
    .getByRole("button", { name: "更多操作 " + job.display_name, exact: true })
    .click();
  await page.getByLabel("作品显示名称").fill(title);
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.getByLabel("搜索作品").fill(title);
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "更多操作 " + title, exact: true })
    .click();
  await page.getByRole("button", { name: "收藏作品", exact: true }).click();
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "更多操作 " + title, exact: true })
    .click();
  await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await page.getByRole("button", { name: "只移除记录" }).click();
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toHaveCount(0);
  expect(
    (await request.get("/api/media/" + job.output_asset_id)).ok(),
  ).toBeTruthy();
  await page.getByRole("tab", { name: "回收站" }).click();
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("tab", { name: "全部生成" }).click();
  await expect(
    page.getByRole("button", { name: "试听 " + title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "更多操作 " + title, exact: true })
    .click();
  await page.getByRole("button", { name: "移入回收站", exact: true }).click();
  await page.getByRole("button", { name: "记录与生成文件一起移入" }).click();
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toHaveCount(0);
  expect(
    (await request.get("/api/media/" + job.output_asset_id)).ok(),
  ).toBeFalsy();
  await page.getByRole("tab", { name: "回收站" }).click();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("tab", { name: "全部生成" }).click();
  await expect(
    page.getByRole("button", { name: "下载 " + title, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "下载 " + title, exact: true }),
  ).toBeVisible();
  expect(
    (await request.get("/api/media/" + job.output_asset_id)).ok(),
  ).toBeTruthy();
});

test("两候选经过预检与费用确认，生成对应版本并保留不同种子", async ({
  page,
  request,
}) => {
  const draft = await project(request, "验收 · 双候选");
  await goProject(page, draft.id);
  await page.getByRole("button", { name: "2 个候选" }).click();
  await page.getByRole("button", { name: "生成音频", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认生成", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("2 个候选");
  const before = await api(
    request,
    "GET",
    "/api/library?project_id=" + draft.id,
  );
  expect(before.total).toBe(0);
  const submission = page.waitForResponse(
    (response) =>
      response.url().includes("/api/generation-requests") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "确认并生成" }).click();
  const batch = await (await submission).json();
  expect(batch.job_ids).toHaveLength(2);
  await expect(page).toHaveURL(new RegExp("/results/" + batch.job_ids[0]));
  await expect
    .poll(
      async () =>
        (
          await api(request, "GET", "/api/library?project_id=" + draft.id)
        ).items.filter((item: { status: string }) => item.status === "success")
          .length,
    )
    .toBe(2);
  const results = await api(
    request,
    "GET",
    "/api/library?project_id=" + draft.id,
  );
  expect(
    results.items.map((item: { seed: number }) => item.seed).sort(),
  ).toEqual([42, 43]);
  await expect(
    page.getByRole("button", { name: /版本 [A-Z] · Seed/ }),
  ).toHaveCount(2);
});

test("历史详情返回保留筛选，续作恢复所选版本快照", async ({
  page,
  request,
}) => {
  const jobs = await api(request, "GET", "/api/library?status=success");
  const chosen = jobs.items[0];
  await page.goto("/library?status=success&mode=" + chosen.mode);
  const before = new URL(page.url()).search;
  await page
    .getByRole("link", { name: chosen.display_name, exact: true })
    .first()
    .click();
  await page.locator('.result-back').click();
  await expect(page).toHaveURL(
    new RegExp("/library" + before.replace(/[?]/g, "\\?")),
  );
  await page.goto("/library?continue=" + chosen.id);
  const dialog = page.getByRole("dialog", { name: "继续创作" });
  await expect(dialog).toContainText(chosen.prompt);
  await dialog.getByRole("button", { name: "创建续作草稿" }).click();
  await expect(page.getByLabel("场景提示词")).toHaveValue(chosen.prompt);
  const id = new URL(page.url()).searchParams.get("project");
  const resumed = await api(request, "GET", "/api/projects/" + id);
  expect(resumed.params).toEqual(chosen.params);
  expect(resumed.output_directory_id).toEqual(chosen.output_directory_id);
});

test("参考音频手动裁剪、持久保存、刷新后复用并逐次确认上传", async ({
  page,
  request,
}) => {
  const draft = await project(request, "验收 · 本地音色");
  await goProject(page, draft.id);
  await page.getByRole("button", { name: /添加参考音色/ }).click();
  const drawer = page.getByRole("dialog", { name: "参考音色", exact: true });
  await drawer
    .getByLabel("导入参考音频")
    .setInputFiles({
      name: "synthetic-reference.wav",
      mimeType: "audio/wav",
      buffer: wavBuffer(),
    });
  await expect(drawer.getByLabel("裁剪终点")).toHaveValue("40");
  await expect(drawer.getByRole("button", { name: "准备片段" })).toBeDisabled();
  await drawer.getByLabel("裁剪起点").fill("2");
  await drawer.getByLabel("裁剪终点").fill("8");
  await drawer.getByLabel("音色名称").fill("验收合成音色");
  await drawer
    .getByRole("checkbox", { name: "保存到我的音色，方便下次使用" })
    .check();
  await drawer.getByRole("button", { name: "准备片段" }).click();
  await expect(drawer).toContainText("片段已准备");
  await expect(drawer).toContainText("6.00 秒");
  await drawer.getByRole("button", { name: "应用这个音色" }).click();
  await expect(page.getByText("验收合成音色", { exact: true })).toBeVisible();
  await page
    .getByLabel("场景提示词")
    .fill(
      "【角色：@voice1】\n【对白：@voice1】这是一次使用合成测试音色的本地流程验收。",
    );
  await settled(page);
  await page.reload();
  await page.getByRole("button", { name: /添加参考音色/ }).click();
  await page.getByRole("tab", { name: "我的音色", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "参考音色" })
      .getByText("验收合成音色", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "参考音色" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "生成音频", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: /确认生成|确认上传参考音频/,
  });
  await expect(confirmation).toContainText("验收合成音色");
  await expect(confirmation).toContainText("6");
  const batchResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/generation-requests") &&
      response.request().method() === "POST",
  );
  await confirmation
    .getByRole("button", { name: /确认并生成|确认上传并生成/ })
    .click();
  const batch = await (await batchResponse).json();
  expect(batch.job_ids).toHaveLength(1);
  await expect
    .poll(
      async () =>
        (await api(request, "GET", "/api/jobs/" + batch.job_ids[0])).status,
    )
    .toBe("success");
  const references = await api(
    request,
    "GET",
    "/api/references?persistent=true",
  );
  expect(
    references.find(
      (reference: { name: string }) => reference.name === "验收合成音色",
    ),
  ).toMatchObject({ persistent: true, duration_seconds: 6 });
});
