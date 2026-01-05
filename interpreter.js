class IScriptError extends Error {
  constructor(message, lineNumber) {
    super(`[${lineNumber}] ${message}`);
    this.lineNumber = lineNumber;
  }
}

class IScriptRuntime {
  constructor(source, hooks = {}) {
    this.source = source;
    this.lines = source.split(/\r?\n/);

    this.onLog = hooks.onLog || (() => {});
    this.onEnd = hooks.onEnd || (() => {});

    this.interpreterVersion = 1.0;

    this.meta = {
      title: "",
      description: "",
      author: "",
      requiredVersion: 0
    };
    this.defined = false;

    this.labels = new Map();

    this.MAX_EXECUTION_COUNT = 512;

    this.resetRuntime();
  }

  /* ---------- runtime reset ---------- */

  resetRuntime() {
    this.pc = 0;
    this.state = "STOPPED";
    this.returnCode = null;
    this.abortController = new AbortController();
    this.executionCount = 0;
  }

  /* ---------- preload ---------- */

  preloadDefine() {
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i].split(";")[0].trim();
      if (!line) continue;
      if (line === "[EOF]") break;

      if (line.startsWith("define ")) {
        this.cmdDefine(line.slice(7), i + 1, true);
        return;
      }
    }
  }

  /* ---------- label resolve ---------- */

  resolveLabels() {
    this.labels.clear();

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i].split(";")[0].trim();

      if (line === "[EOF]") {
        // EOF まで来たが未解決ラベルはエラー
        return;
      }

      if (line.startsWith("#")) {
        this.labels.set(line.slice(1), i);
      }
    }
  }

  /* ---------- control ---------- */

  stop() {
    this.abortController.abort();
    this.state = "STOPPED";
    this.onLog("実行停止");
  }

  async run() {
    this.resetRuntime();
    this.state = "RUNNING";
    this.onLog("実行開始");

    this.resolveLabels();

    try {
      while (this.pc < this.lines.length) {
        const lineNumber = this.pc + 1;
        const raw = this.lines[this.pc++];
        const line = raw.split(";")[0].trim();

        if (!line) continue;

        /* EOF に到達したら -1 */
        if (line === "[EOF]") {
          this.finishWithCode(-1, "[EOF] に到達");
          return;
        }

        if (line.startsWith("#")) continue;

        await this.execute(line, lineNumber);
      }

      /* ファイル末尾まで end 無し */
      this.finishWithCode(-1, "end が無いため終了");

    } catch (e) {
      if (e.name !== "AbortError" && e.message !== "ScriptEnd") {
        throw e;
      }
    }
  }

  /* ---------- execution ---------- */

  async tick() {
    await new Promise(resolve => setTimeout(resolve, 1));
  }

  async execute(line, lineNumber) {
    this.executionCount++;
    if (this.executionCount > this.MAX_EXECUTION_COUNT) {
      this.finishWithCode(-100, "命令実行回数が上限を超過");
      throw new Error("ScriptEnd");
    }

    const [cmd, ...rest] = line.split(" ");

    try {
      switch (cmd) {
        case "define":
          this.cmdDefine(rest.join(" "), lineNumber, false);
          break;

        case "popup":
          this.cmdPopup(rest.join(" "));
          break;

        case "sleep":
          await this.cmdSleep(Number(rest[0]));
          break;

        case "goto":
          this.cmdGoto(rest[0], lineNumber);
          break;

        case "navigate":
          this.cmdNavigate(rest.join(" "), lineNumber);
          break;

        case "end":
          this.cmdEnd(Number(rest[0] ?? 0));
          break;

        case "select": {
          const m = rest.join(" ").match(/^"([^"]*)" +"([^"]*)"$/);
          if (!m) {
             throw new IScriptError("select の構文が不正です", lineNumber);
          }
          await this.cmdSelect(m[1], m[2], lineNumber);
          break;
        }


        default:
          this.onLog(`無視: ${line}`);
      }
    await this.tick();
    } catch (e) {
      if (e instanceof IScriptError) throw e;
      throw new IScriptError(e.message, lineNumber);
    }
  }

  /* ---------- commands ---------- */

  cmdDefine(arg, lineNumber, preload) {
    if (this.defined) {
      this.onLog("define は無視されました");
      return;
    }

    const m = arg.match(
      /^"([^"]*)" +"([^"]*)" +"([^"]*)" +([\d.]+)$/
    );

    if (!m) {
      throw new IScriptError("define の構文が不正です", lineNumber);
    }

    const [, title, desc, author, ver] = m;
    const required = Number(ver);

    if (required > this.interpreterVersion) {
      throw new IScriptError(
        `必要バージョン ${required} は未対応です`,
        lineNumber
      );
    }

    this.meta = { title, description: desc, author, requiredVersion: required };
    this.defined = true;

    if (!preload) {
      this.onLog(`define: ${title} (v${required})`);
    }
  }

  cmdPopup(arg) {
    const m = arg.match(/^"(.*)"$/);
    const text = m ? m[1].replace(/\\n/g, "\n") : "";
    alert(text);
    this.onLog(`popup: ${text}`);
  }

  async cmdSleep(ms) {
    this.onLog(`sleep ${ms}`);
    await new Promise((resolve, reject) => {
      const id = setTimeout(resolve, ms);
      this.abortController.signal.addEventListener("abort", () => {
        clearTimeout(id);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }

  cmdGoto(label, lineNumber) {
    if (!label || !label.startsWith("#")) {
      throw new IScriptError("goto の引数が不正です", lineNumber);
    }

    const name = label.slice(1);
    if (!this.labels.has(name)) {
      this.finishWithCode(-2, `ラベル ${name} が見つかりません`);
      throw new Error("ScriptEnd");
    }

    this.pc = this.labels.get(name);
    this.onLog(`goto #${name}`);
  }

async cmdNavigate(arg, lineNumber) {
  const m = arg.match(/^(open) +"([^"]+)"$/);
  if (!m) {
    throw new IScriptError("navigate の構文が不正です", lineNumber);
  }

  const [, type, url] = m;
  if (type !== "open") {
    throw new IScriptError("navigate のタイプが不正です", lineNumber);
  }

  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  await browser.tabs.create({
    url
  });

  this.onLog(`navigate open ${url}`);
}

  cmdEnd(code) {
    this.finishWithCode(code, `end ${code}`);
    throw new Error("ScriptEnd");
  }

async cmdSelect(title, message, lineNumber) {
  const options = [];
  let i = this.pc;

  while (i < this.lines.length) {
    const raw = this.lines[i].split(";")[0].trim();
    if (!raw.startsWith('@')) break;
    options.push(raw);
    i++;
  }

  if (options.length < 1 || options.length > 5) {
    this.finishWithCode(-3, "select の選択肢数が不正");
    throw new Error("ScriptEnd");
  }

  const parsed = options.map(line => {
    const m = line.match(/^@"([^"]+)",(.+)$/);
    if (!m) {
      throw new IScriptError("select 選択肢の構文が不正", lineNumber);
    }
    return {
      text: m[1],
      target: m[2].trim()
    };
  });

  this.pc = i; // continue 時の位置

  const choice = await this.openSelectUI(
    title,
    message,
    parsed.map(p => p.text)
  );

  const index = (choice == null) ? 0 : choice;
  const target = parsed[index].target;

  if (target === "continue") return;

  if (!target.startsWith("#")) {
    throw new IScriptError("select のジャンプ先が不正です", lineNumber);
  }

  const label = target.slice(1);
  if (!this.labels.has(label)) {
    this.finishWithCode(-2, `ラベル ${label} が見つかりません`);
    throw new Error("ScriptEnd");
  }

  this.pc = this.labels.get(label);
}

openSelectUI(title, message, choices) {
  return new Promise(async resolve => {
    const win = await browser.windows.create({
      url:
        browser.runtime.getURL("ui.select.html") +
        `?title=${encodeURIComponent(title)}` +
        `&message=${encodeURIComponent(message)}` +
        `&choices=${encodeURIComponent(JSON.stringify(choices))}`,
      type: "popup",
      width: 320,
      height: 300
    });

    const listener = msg => {
      if (msg?.type === "select-result") {
        browser.runtime.onMessage.removeListener(listener);
        resolve(msg.index);
      }
    };

    browser.runtime.onMessage.addListener(listener);

    setTimeout(() => {
      browser.runtime.onMessage.removeListener(listener);
      resolve(null);
    }, 60_000);
  });
}



  /* ---------- finish ---------- */

  finishWithCode(code, reason) {
    if (this.state === "ENDED") return;

    this.returnCode = code;
    this.state = "ENDED";
    this.onLog(reason);
    this.onEnd(code);
  }
}
