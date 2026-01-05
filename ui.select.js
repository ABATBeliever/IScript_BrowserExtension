const params = new URLSearchParams(location.search);

const title = params.get("title") || "";
const message = params.get("message") || "";
const choices = JSON.parse(params.get("choices") || "[]");

document.getElementById("title").textContent = title;
document.getElementById("message").textContent = message;

const container = document.getElementById("choices");

choices.forEach((text, index) => {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.onclick = () => {
    chrome.runtime.sendMessage({
      type: "select-result",
      index
    });
    window.close();
  };
  container.appendChild(btn);
});
