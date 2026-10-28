export interface CodexOptions {
  nodePath: string;
  codexEntry: string;
  cwd: string;
  sandbox: 'read-only' | 'workspace-write';
  signal?: AbortSignal;
  onEvent?: (event: any) => void;
}

export async function runCodex(task: string, options: CodexOptions): Promise<{ text: string; stderr: string }> {
  options.signal?.throwIfAborted();
  const child = spawn(options.nodePath, [options.codexEntry, 'exec', '--json', '--sandbox', options.sandbox, '-'], {
    cwd: options.cwd, shell: false, windowsHide: true,
  });
  let text = '';
  let stderr = '';
  let pending = '';
  let failure: Error | undefined;
  let stopping: Promise<void> | undefined;
  const decoder = new StringDecoder('utf8');

  const stopOwned = () => {
    if (stopping || !child.pid) return;
    stopping = new Promise<void>((resolve, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false });
      killer.on('error', reject);
      killer.on('close', () => resolve());
    }).catch((error) => { failure = error; });
  };
  const record = (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text;
      if (event.type === 'turn.failed') failure = new Error(event.error?.message ?? 'Codex turn failed');
      if (event.type === 'error') failure = new Error(event.message ?? 'Codex error');
      options.onEvent?.(event);
    } catch (error) {
      failure = new Error('Invalid Codex JSONL: ' + String(error));
      stopOwned();
    }
  };
  child.stdout.on('data', (chunk: Buffer) => {
    pending += decoder.write(chunk);
    let boundary: number;
    while ((boundary = pending.indexOf('\n')) !== -1) {
      record(pending.slice(0, boundary));
      pending = pending.slice(boundary + 1);
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  child.stdin.on('error', (error) => { failure = error; });
  options.signal?.addEventListener('abort', stopOwned, { once: true });
  try {
    const closed = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    child.stdin.end(task, 'utf8');
    const code = await closed;
    await stopping;
    pending += decoder.end();
    if (pending.trim()) record(pending);
    if (options.signal?.aborted) throw new Error('Codex task cancelled');
    if (code !== 0) throw new Error(`Codex exit ${code}: ${stderr.trim()}`);
    if (failure) throw failure;
    return { text: text || 'Codex 已结束，未返回最终文本。', stderr };
  } finally {
    options.signal?.removeEventListener('abort', stopOwned);
  }
}
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';


export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: 'run_codex',
    label: 'Codex',
    executionMode: 'sequential',
    description: '在当前项目中调用 Codex 执行代码任务与测试。权限由应用设置决定。',
    parameters: Type.Object({ task: Type.String({ description: '完整任务、必要背景与验收要求' }) }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const settings = JSON.parse(readFileSync(new URL('../.local/settings.json', import.meta.url), 'utf8'));
      const result = await runCodex(params.task, {
        nodePath: settings.nodePath, codexEntry: settings.codexEntry, cwd: ctx.cwd,
        sandbox: process.env.KGUI_CODEX_SANDBOX === 'workspace-write' ? 'workspace-write' : 'read-only',
        signal,
        onEvent: (event) => onUpdate?.({
          content: [{ type: 'text', text: event.item?.text ?? event.item?.command ?? event.type }],
          details: { source: 'codex', event },
        }),
      });
      return { content: [{ type: 'text', text: result.text }], details: { source: 'codex', stderr: result.stderr } };
    },
  }));
}
