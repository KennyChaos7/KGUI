import type { AgentEvent } from "./mygo";
import { renderReport } from "./reports";

interface TaskCard {
  node: HTMLDetailsElement;
  state: HTMLElement;
  duration: HTMLElement;
  result: HTMLElement;
  resultSection: HTMLElement;
  records: HTMLElement;
  files: HTMLElement;
  evidence: HTMLElement;
  usage: HTMLElement;
  items: Map<string, HTMLElement>;
}

/** Renders only observed Pi calls and their corresponding Codex evidence. */
export class Delegations {
  private cards = new Map<string, TaskCard>();
  private currentCalls: string[] = [];

  constructor(private container: HTMLElement, private count: HTMLElement) {}

  reset() {
    this.cards.clear();
    this.currentCalls = [];
    this.container.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "delegations-empty";
    empty.innerHTML = '<span class="empty-orbit">↗</span><p>还没有委派任务</p><small>Pi 下发的任务、执行记录与返回结果</small>';
    this.container.append(empty);
    this.count.textContent = "0";
  }

  beginRequest() {
    this.currentCalls = [];
    for (const card of this.cards.values()) card.node.open = false;
  }

  start(event: AgentEvent) {
    if (event.text !== "run_codex") return;
    const data = event.data as Record<string, any>;
    const task = String(data.args.task);
    this.container.querySelector(".delegations-empty")?.remove();
    const node = document.createElement("details");
    node.className = "delegation";
    node.open = true;
    node.dataset.state = "running";
    node.innerHTML = `
      <summary class="delegation-summary"><div class="delegation-meta"><span class="executor"></span><span class="task-state">执行中</span></div><p class="task-title"></p><div class="task-evidence"><span class="evidence-text">等待执行记录</span><span class="duration"></span><span class="disclosure">⌄</span></div></summary>
      <div class="delegation-body">
        <section class="assignment"><h3>Pi 下发的任务</h3><div class="assignment-text"></div></section>
        <section class="file-section" hidden><h3>文件变更</h3><div class="changed-files"></div></section>
        <section class="executor-result" hidden><h3>Codex 返回结果</h3><div class="result-text"></div></section>
        <details class="execution-details"><summary>执行明细</summary><div class="execution-records"></div></details>
        <div class="task-usage" hidden></div>
      </div>`;
    node.querySelector(".executor")!.textContent = "Codex · " + String(this.cards.size + 1).padStart(2, "0");
    node.querySelector(".task-title")!.textContent = task.trim().split("\n")[0] || "Codex 任务";
    node.querySelector(".assignment-text")!.textContent = task;
    const card: TaskCard = {
      node,
      state: node.querySelector(".task-state")!,
      duration: node.querySelector(".duration")!,
      result: node.querySelector(".result-text")!,
      resultSection: node.querySelector(".executor-result")!,
      records: node.querySelector(".execution-records")!,
      files: node.querySelector(".changed-files")!,
      evidence: node.querySelector(".evidence-text")!,
      usage: node.querySelector(".task-usage")!,
      items: new Map(),
    };
    this.cards.set(event.taskId!, card);
    this.currentCalls.push(event.taskId!);
    this.container.append(node);
    this.count.textContent = String(this.cards.size);
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  update(event: AgentEvent) {
    const card = this.cards.get(event.taskId!);
    if (!card) return;
    const data = event.data as Record<string, any> | undefined;
    const item = data?.item as Record<string, any> | undefined;
    if (item?.type === "command_execution") {
      let record = card.items.get(String(item.id));
      if (!record) {
        record = document.createElement("details");
        record.className = "command";
        record.innerHTML = '<summary><span class="command-state"></span><code></code></summary><pre></pre>';
        card.records.append(record);
        card.items.set(String(item.id), record);
      }
      record.querySelector("code")!.textContent = String(item.command);
      record.querySelector(".command-state")!.textContent = item.status === "in_progress" ? "执行中" : "退出 " + String(item.exit_code);
      record.dataset.running = String(item.status === "in_progress");
      record.dataset.failed = String(item.exit_code != null && item.exit_code !== 0);
      record.querySelector("pre")!.textContent = String(item.aggregated_output || "");
    } else if (item?.type === "file_change") {
      let group = card.items.get(String(item.id));
      if (!group) {
        group = document.createElement("ul");
        card.files.append(group);
        card.items.set(String(item.id), group);
      }
      group.replaceChildren();
      for (const change of item.changes ?? []) {
        const row = document.createElement("li");
        const kind = document.createElement("span");
        kind.className = "change-kind";
        kind.textContent = ({ add: "新增", delete: "删除", update: "修改" } as Record<string, string>)[change.kind] ?? String(change.kind);
        const path = document.createElement("code");
        path.textContent = String(change.path);
        row.append(kind, path);
        group.append(row);
      }
      card.node.querySelector<HTMLElement>(".file-section")!.hidden = false;
    } else if (event.type === "turn.completed") {
      const usage = data?.usage;
      if (usage) {
        card.usage.hidden = false;
        card.usage.textContent = "Codex tokens · 输入 " + Number(usage.input_tokens || 0).toLocaleString() + " / 输出 " + Number(usage.output_tokens || 0).toLocaleString();
      }
    } else if (event.type === "task_result") {
      const failed = Boolean(data?.isError);
      card.node.dataset.state = failed ? "failed" : "returned";
      card.state.textContent = failed ? "执行失败" : "已返回";
      card.resultSection.hidden = false;
      renderReport(card.result, event.text || "未返回文本结果。");
      if (typeof data?.durationMs === "number") card.duration.textContent = (data.durationMs / 1000).toFixed(1) + "s";
    }
    const files = card.files.querySelectorAll("li").length;
    const evidence = [];
    const commands = card.records.querySelectorAll(".command").length;
    if (commands) evidence.push(commands + " 条命令");
    if (files) evidence.push(files + " 个文件");
    card.evidence.textContent = evidence.join(" · ") || (card.node.dataset.state === "running" ? "执行中" : "无命令或文件变更");
  }

  settle(status: string) {
    if (status !== "已取消" && status !== "会话已关闭") return;
    for (const id of this.currentCalls) {
      const card = this.cards.get(id)!;
      if (card.node.dataset.state !== "returned") {
        card.node.dataset.state = status === "已取消" ? "cancelled" : "interrupted";
        card.state.textContent = status === "已取消" ? "已取消" : "会话中断";
        for (const record of card.records.querySelectorAll<HTMLElement>('.command[data-running="true"]')) {
          record.dataset.running = "false";
          record.querySelector(".command-state")!.textContent = status === "已取消" ? "已停止" : "未收到完成状态";
        }
      }
    }
  }
}
