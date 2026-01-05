let runtime = null;

const fileInput = document.getElementById("file");
const logEl = document.getElementById("log");
const retEl = document.getElementById("ret");

function log(msg) {
  logEl.textContent += msg + "\n";
}

function setMeta(meta) {
  document.getElementById("meta-title").textContent = meta.title || "-";
  document.getElementById("meta-desc").textContent = meta.description || "-";
  document.getElementById("meta-author").textContent = meta.author || "-";
  document.getElementById("meta-ver").textContent = meta.requiredVersion ?? "-";
}

/* ★ ファイル選択時に define を読み込む */
fileInput.onchange = async () => {
  if (!fileInput.files[0]) return;

  const text = await fileInput.files[0].text();

  runtime = new IScriptRuntime(text, { onLog: log });

  try {
    runtime.preloadDefine();
    setMeta(runtime.meta);
  } catch (e) {
    log(e.message);
  }
};

document.getElementById("run").onclick = async () => {
  if (!runtime) return;

  logEl.textContent = "";
  retEl.textContent = "-";

  runtime.run().catch(e => {
    log(e.message);
  });
};

document.getElementById("stop").onclick = () => {
  if (runtime) runtime.stop();
};
