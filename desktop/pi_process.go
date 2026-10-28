package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

type AgentEvent struct {
	Source string `json:"source"`
	Type   string `json:"type"`
	Text   string `json:"text"`
	TaskID string `json:"taskId,omitempty"`
	Data   any    `json:"data,omitempty"`
}

type piProcess struct {
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	emit     func(AgentEvent)
	mu       sync.Mutex
	writeMu  sync.Mutex
	pending  map[string]chan error
	sequence uint64
	busy     bool
	failed   bool
	runDone  chan struct{}
	done     chan struct{}
}

func readPiRecords(input io.Reader, consume func(map[string]any)) error {
	reader := bufio.NewReader(input)
	for {
		line, err := reader.ReadBytes('\n')
		if len(strings.TrimSpace(string(line))) > 0 {
			var record map[string]any
			if decodeErr := json.Unmarshal(line, &record); decodeErr != nil {
				return fmt.Errorf("Pi JSONL: %w", decodeErr)
			}
			consume(record)
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func startPiCommand(cmd *exec.Cmd, emit func(AgentEvent)) (*piProcess, error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	p := &piProcess{cmd: cmd, stdin: stdin, emit: emit, pending: make(map[string]chan error), done: make(chan struct{})}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return nil, err
	}
	go func() {
		reader := bufio.NewReader(stderr)
		for {
			line, err := reader.ReadString('\n')
			if strings.TrimSpace(line) != "" {
				emit(AgentEvent{Source: "app", Type: "diagnostic", Text: strings.TrimSpace(line)})
			}
			if err != nil {
				return
			}
		}
	}()
	go func() {
		readErr := readPiRecords(stdout, p.handle)
		if readErr != nil {
			p.emit(AgentEvent{Source: "app", Type: "error", Text: readErr.Error()})
			_ = killTree(cmd.Process.Pid)
		}
		waitErr := cmd.Wait()
		err := errors.New("Pi 会话已关闭")
		if waitErr != nil {
			err = fmt.Errorf("Pi 退出: %w", waitErr)
		}
		p.mu.Lock()
		for id, response := range p.pending {
			response <- err
			delete(p.pending, id)
		}
		p.mu.Unlock()
		p.finish("会话已关闭")
		p.emit(AgentEvent{Source: "app", Type: "disconnected", Text: err.Error()})
		close(p.done)
	}()
	return p, nil
}

func (p *piProcess) Busy() bool { p.mu.Lock(); defer p.mu.Unlock(); return p.busy }

func (p *piProcess) Send(text string) error {
	p.mu.Lock()
	if p.busy {
		p.mu.Unlock()
		return errors.New("已有任务正在运行")
	}
	p.busy = true
	p.failed = false
	p.runDone = make(chan struct{})
	p.mu.Unlock()
	p.emit(AgentEvent{Source: "app", Type: "busy", Text: "运行中"})
	return p.request("prompt", map[string]any{"message": text})
}

func (p *piProcess) request(kind string, fields map[string]any) error {
	p.mu.Lock()
	p.sequence++
	id := fmt.Sprintf("request-%d", p.sequence)
	response := make(chan error, 1)
	p.pending[id] = response
	p.mu.Unlock()
	defer func() { p.mu.Lock(); delete(p.pending, id); p.mu.Unlock() }()
	if fields == nil {
		fields = make(map[string]any)
	}
	fields["id"], fields["type"] = id, kind
	line, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	p.writeMu.Lock()
	_, err = p.stdin.Write(append(line, '\n'))
	p.writeMu.Unlock()
	if err != nil {
		return err
	}
	select {
	case err := <-response:
		return err
	case <-p.done:
		return errors.New("Pi 会话已关闭")
	case <-time.After(10 * time.Second):
		return errors.New("Pi 请求响应超时")
	}
}

func (p *piProcess) finish(text string) {
	p.mu.Lock()
	if !p.busy {
		p.mu.Unlock()
		return
	}
	p.busy = false
	close(p.runDone)
	if p.failed && text == "已结束" {
		text = "任务失败"
	}
	p.mu.Unlock()
	p.emit(AgentEvent{Source: "app", Type: "idle", Text: text})
}

func (p *piProcess) handle(record map[string]any) {
	kind, _ := record["type"].(string)
	switch kind {
	case "response":
		id, _ := record["id"].(string)
		var err error
		if success, _ := record["success"].(bool); !success {
			err = fmt.Errorf("%v", record["error"])
		}
		p.mu.Lock()
		response := p.pending[id]
		delete(p.pending, id)
		p.mu.Unlock()
		if response != nil {
			response <- err
		}
		if err != nil {
			p.emit(AgentEvent{Source: "pi", Type: "error", Text: err.Error()})
			if record["command"] == "prompt" {
				p.finish("任务失败")
			}
		}
	case "message_update":
		update, _ := record["assistantMessageEvent"].(map[string]any)
		if update["type"] == "text_delta" {
			text, _ := update["delta"].(string)
			p.emit(AgentEvent{Source: "pi", Type: "delta", Text: text})
		}
	case "message_end":
		message, _ := record["message"].(map[string]any)
		if message["role"] != "assistant" {
			return
		}
		var text strings.Builder
		content, _ := message["content"].([]any)
		for _, item := range content {
			block, _ := item.(map[string]any)
			if block["type"] == "text" {
				value, _ := block["text"].(string)
				text.WriteString(value)
			}
		}
		if text.Len() > 0 {
			p.emit(AgentEvent{Source: "pi", Type: "message", Text: text.String()})
		}
		if message["stopReason"] == "error" {
			p.mu.Lock()
			p.failed = true
			p.mu.Unlock()
			p.emit(AgentEvent{Source: "pi", Type: "error", Text: fmt.Sprint(message["errorMessage"])})
		}
	case "tool_execution_start":
		id, _ := record["toolCallId"].(string)
		p.emit(AgentEvent{Source: "pi", Type: "tool_start", TaskID: id, Text: fmt.Sprint(record["toolName"]), Data: record})
	case "tool_execution_update":
		partial, _ := record["partialResult"].(map[string]any)
		details, _ := partial["details"].(map[string]any)
		if details["source"] != "codex" {
			return
		}
		event, _ := details["event"].(map[string]any)
		item, _ := event["item"].(map[string]any)
		text, _ := item["text"].(string)
		if text == "" {
			text, _ = item["command"].(string)
		}
		eventType, _ := event["type"].(string)
		id, _ := record["toolCallId"].(string)
		p.emit(AgentEvent{Source: "codex", Type: eventType, TaskID: id, Text: text, Data: event})
	case "tool_execution_end":
		id, _ := record["toolCallId"].(string)
		result, _ := record["result"].(map[string]any)
		content, _ := result["content"].([]any)
		var parts []string
		for _, value := range content {
			block, _ := value.(map[string]any)
			if block["type"] == "text" {
				text, _ := block["text"].(string)
				parts = append(parts, text)
			}
		}
		text := strings.Join(parts, "\n")
		if record["toolName"] == "run_codex" {
			p.emit(AgentEvent{Source: "codex", Type: "task_result", TaskID: id, Text: text, Data: record})
		}
		if failed, _ := record["isError"].(bool); failed {
			p.mu.Lock()
			p.failed = true
			p.mu.Unlock()
			source := "pi"
			if record["toolName"] == "run_codex" {
				source = "codex"
			}
			p.emit(AgentEvent{Source: source, Type: "error", TaskID: id, Text: text})
		}
	case "agent_settled":
		text := "已结束"
		if aborted, _ := record["aborted"].(bool); aborted {
			text = "已取消"
		}
		p.finish(text)
	}
}

func (p *piProcess) Stop() error {
	p.mu.Lock()
	busy, runDone := p.busy, p.runDone
	p.mu.Unlock()
	if !busy {
		return nil
	}
	if err := p.request("abort", nil); err != nil {
		return err
	}
	select {
	case <-runDone:
		return nil
	case <-p.done:
		return nil
	case <-time.After(5 * time.Second):
		return errors.New("任务停止超时")
	}
}

func killTree(pid int) error {
	cmd := exec.Command("taskkill.exe", "/PID", fmt.Sprint(pid), "/T", "/F")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

func (p *piProcess) Close() error {
	if p.Busy() {
		if err := p.Stop(); err != nil {
			if killErr := killTree(p.cmd.Process.Pid); killErr != nil {
				select {
				case <-p.done:
					return nil
				default:
					return killErr
				}
			}
		}
	}
	_ = p.stdin.Close()
	select {
	case <-p.done:
		return nil
	case <-time.After(2 * time.Second):
	}
	if err := killTree(p.cmd.Process.Pid); err != nil {
		select {
		case <-p.done:
			return nil
		default:
			return err
		}
	}
	select {
	case <-p.done:
		return nil
	case <-time.After(5 * time.Second):
		return errors.New("Pi 进程退出超时")
	}
}
