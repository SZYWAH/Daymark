import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Playwright-only archive audit; the .pw.ts suffix keeps Vitest from collecting it.

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1023, height: 768 },
  { width: 1024, height: 768 },
  { width: 1279, height: 800 },
  { width: 1280, height: 820 },
  { width: 1440, height: 900 },
];
const palettes = ["daymark", "graphite", "mist", "ink", "clay", "fir"];

test("G-02 first-run guide is modal, keyboard trapped, dismissible and persistent", async ({ page }) => {
  await loadApp(page);
  const dialog = page.getByRole("dialog", { name: /把今天做过的事/ });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "开始记录" })).toBeFocused();
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.getByRole("button", { name: "关闭使用引导" }).click();
  await expect(dialog).toBeHidden();
  const reopened = await page.context().newPage();
  await loadApp(reopened);
  await expect(reopened.getByRole("dialog", { name: /把今天做过的事/ })).toBeHidden();
  await ready(reopened);
  await reopened.close();
});

test("G-03/S-01 primary navigation exposes one current page and all six routes", async ({ page }) => {
  await bootstrap(page);
  const nav = visibleMainNavigation(page);
  const routes = ["今日", "搜索", "日志", "资料库", "记忆", "设置"];
  for (const label of routes) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await nav.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByPlaceholder("搜索标题、正文、标签、摘要或待办")).toBeVisible();
});

test("A-05 responsive matrix has no document-level horizontal overflow", async ({ page }, testInfo) => {
  await bootstrap(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(120);
    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(metrics.scrollWidth, `${viewport.width}x${viewport.height} html overflow`).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.bodyWidth, `${viewport.width}x${viewport.height} body overflow`).toBeLessThanOrEqual(metrics.innerWidth + 1);
    await page.screenshot({
      path: testInfo.outputPath(`responsive-${viewport.width}x${viewport.height}.png`),
      animations: "disabled",
      fullPage: true,
    });
  }
});

test("C-01 six palettes render in dark and light modes with truthful root state", async ({ page }, testInfo) => {
  await bootstrap(page);
  for (const mode of ["dark", "light"] as const) {
    for (const palette of palettes) {
      await storeTheme(page, mode, palette);
      await reloadApp(page);
      await ready(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await expect(page.locator("html")).toHaveAttribute("data-theme-mode", mode);
      await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
      await page.screenshot({
        path: testInfo.outputPath(`theme-${palette}-${mode}.png`),
        animations: "disabled",
      });
    }
  }
});

test("A-01 import dialog traps Tab, closes with Escape and restores focus", async ({ page }) => {
  await bootstrap(page);
  await visibleMainNavigation(page).getByRole("button", { name: "资料库", exact: true }).click();
  await expect(page.getByPlaceholder("搜索标题、正文、标签、路径或 AI 摘要")).toBeVisible();
  const trigger = page.getByRole("button", { name: "导入资料", exact: true }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "导入资料" });
  await expect(dialog).toBeVisible();
  let escaped: { index: number; tag: string; text: string } | null = null;
  for (let index = 0; index < 25; index += 1) {
    await page.keyboard.press("Tab");
    const state = await dialog.evaluate((node) => ({
      inside: node.contains(document.activeElement),
      tag: document.activeElement?.tagName ?? "none",
      text: (document.activeElement?.textContent ?? "").trim().slice(0, 80),
    }));
    if (!state.inside) {
      escaped = { index: index + 1, tag: state.tag, text: state.text };
      break;
    }
  }
  expect.soft(escaped, `focus escaped import dialog: ${JSON.stringify(escaped)}`).toBeNull();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect.soft(trigger).toBeFocused();
});

test("A-07 axe finds no serious or critical violations on primary pages", async ({ page }, testInfo) => {
  await bootstrap(page);
  const nav = visibleMainNavigation(page);
  const blockingByPage: Array<{ page: string; ids: string[]; nodeCount: number }> = [];
  for (const label of ["今日", "搜索", "日志", "资料库", "记忆", "设置"]) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await page.waitForTimeout(700);
    const result = await new AxeBuilder({ page }).analyze();
    await testInfo.attach(`axe-${label}`, {
      body: JSON.stringify(result.violations, null, 2),
      contentType: "application/json",
    });
    const blocking = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    if (blocking.length) {
      blockingByPage.push({
        page: label,
        ids: blocking.map((item) => item.id),
        nodeCount: blocking.reduce((sum, item) => sum + item.nodes.length, 0),
      });
    }
  }
  expect(blockingByPage).toEqual([]);
});

test("A-07-THEME axe stays clear on Today, Library and Memory across every palette and mode", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await bootstrap(page);
  const blockingBySurface: Array<{ surface: string; ids: string[]; nodeCount: number }> = [];
  for (const mode of ["dark", "light"] as const) {
    for (const palette of palettes) {
      await storeTheme(page, mode, palette);
      await reloadApp(page);
      await ready(page);
      const nav = visibleMainNavigation(page);
      for (const label of ["今日", "资料库", "记忆"]) {
        await nav.getByRole("button", { name: label, exact: true }).click();
        await page.waitForTimeout(700);
        const result = await new AxeBuilder({ page }).analyze();
        const blocking = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
        if (blocking.length) {
          blockingBySurface.push({
            surface: `${palette}-${mode}-${label}`,
            ids: blocking.map((item) => item.id),
            nodeCount: blocking.reduce((sum, item) => sum + item.nodes.length, 0),
          });
        }
      }
    }
  }
  await testInfo.attach("axe-theme-matrix", {
    body: JSON.stringify(blockingBySurface, null, 2),
    contentType: "application/json",
  });
  expect(blockingBySurface).toEqual([]);
});

test("A-08 reduced motion disables continuous animation", async ({ page }) => {
  await bootstrap(page);
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll("*"))
    .filter((node) => {
      const style = getComputedStyle(node);
      const iterations = style.animationIterationCount.split(",").map((value) => value.trim());
      return style.animationName !== "none" && iterations.some((value) => value === "infinite");
    })
    .map((node) => ({ tag: node.tagName, className: (node as HTMLElement).className })));
  expect(animated).toEqual([]);
});

async function bootstrap(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("daymark.onboarding.v1.completed", "true");
  });
  await loadApp(page);
  await ready(page);
}

async function loadApp(page: Page) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/ERR_ABORTED|frame detached|Navigation|Timeout/i.test(message) || attempt === 1) throw error;
      await page.waitForTimeout(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function ready(page: Page) {
  await expect(page.getByRole("button", { name: "今日", exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

async function storeTheme(page: Page, mode: "dark" | "light", palette: string) {
  await page.evaluate(({ mode, palette }) => {
    const preference = {
      version: 1 as const,
      mode,
      palette,
      accent: { mode: "theme-default" as const },
    };
    localStorage.setItem("daymark.ui.appearance.v1", JSON.stringify(preference));
  }, { mode, palette });
}

async function reloadApp(page: Page) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/ERR_ABORTED|frame detached|Navigation|Timeout/i.test(message) || attempt === 1) throw error;
      await page.waitForTimeout(250 * (attempt + 1));
    }
  }
  throw lastError;
}

function visibleMainNavigation(page: Page) {
  return page.getByRole("button", { name: "今日", exact: true }).first().locator("xpath=ancestor::nav[1]");
}
