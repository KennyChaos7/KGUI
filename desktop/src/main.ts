import { AgentService, events, type AgentEvent } from "./mygo";
import { Delegations } from "./delegations";
import { renderReport } from "./reports";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const path = $<HTMLInputElement>("#project-path");
const permission = $<HTMLInputElement>("#allow-edits");
const task = $<HTMLTextAreaElement>("#task");
const messages = $("#messages");
const delegations = new Delegations($("#delegations"), $("#delegation-count"));
let connected = false;
let busy = false;
let opening = false;
let stopping = false;
let activePath = "";
let activePermission = false;
let assistant: HTMLElement | null = null;

function controls() {
  path.disabled = opening;
  permission.disabled = opening || busy || !connected;
  $<HTMLButtonElement>("#browse-project").disabled = opening;
  $<HTMLButtonElement>("#open-project").disabled = opening || !path.value.trim();
  $<HTMLButtonElement>("#change-project").disabled = opening || busy;
  $<HTMLButtonElement>("#reconnect").disabled = opening || busy;
  $("#reconnect").hidden = connected || !activePath;
  task.disabled = !connected || opening;
  $<HTMLButtonElement>("#send").disabled = !connected || opening || busy || !task.value.trim();
  $<HTMLButtonElement>("#stop").disabled = !busy || stopping;
  $("#status").classList.toggle("running", busy || opening);
}

function showError(error: unknown) {
  $("#error-text").textContent = error instanceof Error ? error.message : String(error);
  $("#error").hidden = false;
}

function message(role: "user" | "assistant" | "notice", text: string): HTMLElement {
  $("#welcome")?.remove();
  const article = document.createElement("article");
  article.className = "message " + role;
  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = role === "user" ? "你" : role === "assistant" ? "Pi" : "会话";
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;
  article.append(label, body);
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  return body;
}

function resetProjectContents() {
  messages.replaceChildren();
  const welcome = document.createElement("div");
  welcome.id = "welcome";
  welcome.innerHTML = '<span class="welcome-mark">↗</span><h2>一起推进这个项目</h2><p>描述任务，Pi 将安排执行并汇总结果。</p><small>从阅读代码、定位问题或一项具体修改开始。</small>';
  messages.append(welcome);
  delegations.reset();
  task.value = "";
  assistant = null;
}

async function openProject(target: string, allowEdits = false) {
  opening = true;
  $("#error").hidden = true;
  $("#opening-state").textContent = "正在打开项目…";
  controls();
  try {
    await AgentService.openProject(target, allowEdits);
  } catch (error) {
    permission.checked = activePermission;
    showError(error);
    $("#opening-state").textContent = "未能打开，请核对 Git 仓库路径。";
  } finally {
    opening = false;
    controls();
    if (connected) task.focus();
  }
}

$("#browse-project").addEventListener("click", async () => {
  opening = true;
  controls();
  try {
    const selected = await AgentService.chooseProject();
    if (selected) {
      path.value = selected;
      await openProject(selected);
    }
  } catch (error) { showError(error); } finally { opening = false; controls(); }
});
$("#project-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (path.value.trim() && !opening) void openProject(path.value.trim());
});
path.addEventListener("input", controls);
$("#change-project").addEventListener("click", async () => {
  opening = true;
  controls();
  try { await AgentService.closeProject(); } catch (error) { showError(error); } finally { opening = false; controls(); if (!activePath) path.focus(); }
});
$("#reconnect").addEventListener("click", () => { void openProject(activePath, activePermission); });
permission.addEventListener("change", () => { if (connected) void openProject(activePath, permission.checked); });
$("#dismiss-error").addEventListener("click", () => { $("#error").hidden = true; });
task.addEventListener("input", controls);
task.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.ctrlKey && !busy && task.value.trim()) {
    event.preventDefault();
    $<HTMLFormElement>("#task-form").requestSubmit();
  }
});
$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !connected || !task.value.trim()) return;
  const text = task.value;
  message("user", text);
  assistant = null;
  delegations.beginRequest();
  task.value = "";
  busy = true;
  stopping = false;
  $("#status-text").textContent = "运行中";
  $("#phase").textContent = "Pi 正在安排任务";
  $("#error").hidden = true;
  controls();
  try { await AgentService.send(text); } catch (error) { showError(error); }
});
$("#stop").addEventListener("click", async () => {
  stopping = true;
  $("#status-text").textContent = "正在停止";
  $("#phase").textContent = "等待执行进程退出";
  controls();
  try { await AgentService.stop(); } catch (error) { stopping = false; showError(error); controls(); }
});

events.agentEvent.on((event: AgentEvent) => {
  const data = event.data as Record<string, any> | undefined;
  if (event.type === "project") {
    const changedProject = activePath !== event.text;
    if (changedProject) resetProjectContents();
    else message("notice", "会话已重新连接。后续任务使用新的会话上下文。");
    activePath = path.value = event.text;
    permission.checked = activePermission = Boolean(data?.allowEdits);
    connected = true;
    busy = false;
    stopping = false;
    $("#project-screen").hidden = true;
    $("#workspace").hidden = false;
    $("#project-title").textContent = event.text.split(/[\\/]/).pop() || event.text;
    $("#project-location").textContent = event.text;
    $("#project-location").title = event.text;
    $("#model").textContent = String(data?.model ?? "").replace(":", " · ");
    $("#status-text").textContent = "准备就绪";
    $("#phase").textContent = "准备接收任务";
    task.focus();
  } else if (event.type === "project_closed") {
    activePath = "";
    activePermission = permission.checked = false;
    connected = busy = stopping = false;
    $("#workspace").hidden = true;
    $("#project-screen").hidden = false;
    $("#opening-state").textContent = "以只读模式打开，可在工作区允许修改。";
    resetProjectContents();
    path.focus();
  } else if (event.type === "busy") {
    busy = true;
    $("#status-text").textContent = "运行中";
  } else if (event.type === "idle") {
    busy = false;
    stopping = false;
    assistant = null;
    delegations.settle(event.text);
    $("#status-text").textContent = event.text;
    $("#phase").textContent = event.text === "已取消" ? "任务已停止，可继续发送" : event.text;
  } else if (event.type === "disconnected") {
    connected = false;
    busy = stopping = false;
    $("#status-text").textContent = "会话已关闭";
    $("#phase").textContent = "重新连接后可继续发送任务";
  } else if (event.source === "pi" && event.type === "delta") {
    assistant ??= message("assistant", "");
    assistant.textContent += event.text;
    messages.scrollTop = messages.scrollHeight;
  } else if (event.source === "pi" && event.type === "message") {
    assistant ??= message("assistant", "");
    renderReport(assistant, event.text);
    assistant = null;
  } else if (event.type === "tool_start") {
    delegations.start(event);
    if (event.text === "run_codex" && !stopping) $("#phase").textContent = "Codex 正在执行 Pi 的委派";
  } else if (event.source === "codex") {
    delegations.update(event);
    if (event.type === "task_result" && !stopping) $("#phase").textContent = "Pi 正在核对与汇总结果";
    if (event.type === "error" && !stopping) showError(event.text);
  } else if (event.type === "error") {
    if (!stopping) showError(event.text);
  }
  controls();
});

resetProjectContents();
controls();
