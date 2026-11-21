/**
 * A tiny subset of the `@astral/astral` API implemented on top of
 * Playwright. Astral is Deno-only; this keeps the browser based tests
 * unchanged while running on Bun.
 */
import {
  type Browser as PwBrowser,
  chromium,
  type Page as PwPage,
} from "playwright";

type WaitUntil = "none" | "load" | "networkidle0" | "networkidle2";

export interface GoToOptions {
  waitUntil?: WaitUntil;
}

export interface EvaluateOptions<T extends unknown[]> {
  args?: T;
}

function toPwWaitUntil(
  value: WaitUntil | undefined,
): "load" | "networkidle" | "commit" {
  switch (value) {
    case "none":
      return "commit";
    case "load":
      return "load";
    case "networkidle0":
    case "networkidle2":
    default:
      return "networkidle";
  }
}

export class Locator<T extends Element = Element> {
  #page: PwPage;
  #selector: string;

  constructor(page: PwPage, selector: string) {
    this.#page = page;
    this.#selector = selector;
  }

  #locator() {
    return this.#page.locator(this.#selector).first();
  }

  /** Wait until the element exists in the DOM. */
  async wait(): Promise<void> {
    await this.#locator().waitFor({ state: "attached" });
  }

  async click(): Promise<void> {
    await this.#locator().click();
  }

  async fill(value: string): Promise<void> {
    await this.#locator().fill(value);
  }

  async evaluate<R>(fn: (el: T) => R): Promise<Awaited<R>> {
    await this.wait();
    // deno-lint-ignore no-explicit-any
    return await this.#locator().evaluate(fn as any) as Awaited<R>;
  }
}

export interface ConsoleEventDetail {
  type: string;
  text: string;
}

interface PageEventMap {
  console: CustomEvent<ConsoleEventDetail>;
  pageerror: CustomEvent<Error>;
}

export class Page extends EventTarget {
  #page: PwPage;

  override addEventListener<K extends keyof PageEventMap>(
    type: K,
    listener: (event: PageEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    // deno-lint-ignore no-explicit-any
    listener: any,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  constructor(page: PwPage) {
    super();
    this.#page = page;
    page.on("console", (msg) => {
      this.dispatchEvent(
        new CustomEvent("console", {
          detail: { type: msg.type(), text: msg.text() },
        }),
      );
    });
    page.on("pageerror", (err) => {
      this.dispatchEvent(new CustomEvent("pageerror", { detail: err }));
    });
  }

  /** The underlying Playwright page. */
  get unsafelyGetPlaywrightPage(): PwPage {
    return this.#page;
  }

  get url(): string | undefined {
    return this.#page.url();
  }

  async goto(url: string, options?: GoToOptions): Promise<void> {
    await this.#page.goto(url, {
      waitUntil: toPwWaitUntil(options?.waitUntil),
    });
  }

  locator<T extends Element = Element>(selector: string): Locator<T> {
    return new Locator<T>(this.#page, selector);
  }

  async content(): Promise<string> {
    return await this.#page.content();
  }

  async title(): Promise<string> {
    return await this.#page.title();
  }

  async evaluate<R, A extends unknown[] = unknown[]>(
    fn: string | ((...args: A) => R),
    options?: EvaluateOptions<A>,
  ): Promise<Awaited<R>> {
    if (typeof fn === "string") {
      return await this.#page.evaluate(fn) as Awaited<R>;
    }
    const args = options?.args ?? [];
    if (args.length <= 1) {
      // deno-lint-ignore no-explicit-any
      return await this.#page.evaluate(fn as any, args[0]) as Awaited<R>;
    }
    return await this.#page.evaluate(
      ([src, a]) => (0, eval)(`(${src})`)(...a),
      [fn.toString(), args] as const,
    ) as Awaited<R>;
  }

  async waitForFunction<A extends unknown[]>(
    fn: (...args: A) => unknown,
    options?: EvaluateOptions<A>,
  ): Promise<void> {
    const args = options?.args ?? [];
    if (args.length <= 1) {
      // deno-lint-ignore no-explicit-any
      await this.#page.waitForFunction(fn as any, args[0]);
      return;
    }
    await this.#page.waitForFunction(
      ([src, a]) => (0, eval)(`(${src})`)(...a),
      [fn.toString(), args] as const,
    );
  }

  async waitForSelector(selector: string): Promise<void> {
    await this.#page.locator(selector).first().waitFor({ state: "attached" });
  }

  async waitForNavigation(options?: GoToOptions): Promise<void> {
    await this.#page.waitForNavigation({
      waitUntil: toPwWaitUntil(options?.waitUntil ?? "load"),
    });
  }

  async waitForNetworkIdle(): Promise<void> {
    await this.#page.waitForLoadState("networkidle");
  }

  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array(await this.#page.screenshot());
  }

  async setViewportSize(size: { width: number; height: number }) {
    await this.#page.setViewportSize(size);
  }

  async close(): Promise<void> {
    await this.#page.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export class Browser {
  #browser: PwBrowser;

  constructor(browser: PwBrowser) {
    this.#browser = browser;
  }

  async newPage(url?: string): Promise<Page> {
    const context = await this.#browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const pwPage = await context.newPage();
    pwPage.on("close", () => {
      context.close().catch(() => {});
    });
    const page = new Page(pwPage);
    if (url) await page.goto(url);
    return page;
  }

  async close(): Promise<void> {
    await this.#browser.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export interface LaunchOptions {
  args?: string[];
  headless?: boolean;
}

export async function launch(options: LaunchOptions = {}): Promise<Browser> {
  const browser = await chromium.launch({
    args: options.args,
    headless: options.headless ?? true,
  });
  return new Browser(browser);
}
