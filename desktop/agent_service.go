package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"github.com/egoist/mygo"
)

type runtimeSettings struct {
	NodePath   string `json:"nodePath"`
	CodexEntry string `json:"codexEntry"`
	PiProvider string `json:"piProvider"`
	PiModel    string `json:"piModel"`
}

// AgentService owns the single current Pi session.
type AgentService struct {
	mu   sync.Mutex
	pi   *piProcess
	emit func(AgentEvent)
}

func applicationRoot() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	for directory := filepath.Dir(executable); ; directory = filepath.Dir(directory) {
		if _, err := os.Stat(filepath.Join(directory, ".local", "settings.json")); err == nil {
			return directory, nil
		}
		if filepath.Dir(directory) == directory {
			return "", errors.New("未找到应用 .local/settings.json，请从项目中的开发或构建入口启动")
		}
	}
}

func gitRoot(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	for directory := absolute; ; directory = filepath.Dir(directory) {
		if _, err := os.Stat(filepath.Join(directory, ".git")); err == nil {
			cmd := exec.Command("git", "-c", "safe.directory="+directory, "-C", absolute, "rev-parse", "--show-toplevel")
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			output, err := cmd.CombinedOutput()
			if err != nil {
				return "", fmt.Errorf("无法打开 Git 仓库: %s", strings.TrimSpace(string(output)))
			}
			return filepath.FromSlash(strings.TrimSpace(string(output))), nil
		}
		if filepath.Dir(directory) == directory {
			return "", errors.New("请选择有效的 Git 仓库目录")
		}
	}
}

// OpenProject resolves the Git root and starts Pi with user-selected permissions.
func (s *AgentService) OpenProject(path string, allowEdits bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pi != nil && s.pi.Busy() {
		return errors.New("请先停止当前任务，再切换项目或权限")
	}
	target, err := gitRoot(path)
	if err != nil {
		return err
	}
	root, err := applicationRoot()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(root, ".local", "settings.json"))
	if err != nil {
		return err
	}
	var settings runtimeSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return err
	}
	packageDirectory := filepath.Join(root, "runtime", "node_modules", "@earendil-works", "pi-coding-agent")
	data, err = os.ReadFile(filepath.Join(packageDirectory, "package.json"))
	if err != nil {
		return err
	}
	var piPackage struct {
		Bin struct {
			Pi string `json:"pi"`
		} `json:"bin"`
	}
	if err := json.Unmarshal(data, &piPackage); err != nil {
		return err
	}
	sessionDirectory := filepath.Join(root, ".local", "pi-sessions")
	if err := os.MkdirAll(sessionDirectory, 0700); err != nil {
		return err
	}
	cmd := exec.Command(settings.NodePath, filepath.Join(packageDirectory, piPackage.Bin.Pi),
		"--mode", "rpc", "--no-extensions", "--extension", filepath.Join(root, "runtime", "codex-tool.ts"),
		"--no-mcp", "--tools", "read,grep,find,ls,run_codex", "--session-dir", sessionDirectory,
		"--provider", settings.PiProvider, "--model", settings.PiModel,
		"--append-system-prompt", filepath.Join(root, "runtime", "instructions.md"))
	cmd.Dir = target
	sandbox := "read-only"
	if allowEdits {
		sandbox = "workspace-write"
	}
	cmd.Env = append(os.Environ(), "KGUI_CODEX_SANDBOX="+sandbox,
		"PATH="+strings.Join([]string{filepath.Dir(settings.NodePath), filepath.Join(root, ".tools", "go", "bin"), filepath.Join(root, ".tools", "bun"), os.Getenv("PATH")}, string(os.PathListSeparator)))
	if s.pi != nil {
		if err := s.pi.Close(); err != nil {
			return err
		}
		s.pi = nil
	}
	p, err := startPiCommand(cmd, s.emit)
	if err != nil {
		return err
	}
	if err := p.request("get_state", nil); err != nil {
		_ = p.Close()
		return fmt.Errorf("Pi 启动失败: %w", err)
	}
	s.pi = p
	s.emit(AgentEvent{Source: "app", Type: "project", Text: target, Data: map[string]any{"path": target, "allowEdits": allowEdits, "model": settings.PiModel}})
	return nil
}

// Send submits one task; progress and completion arrive as events.
func (s *AgentService) Send(text string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(text) == "" {
		return errors.New("请输入任务内容")
	}
	if s.pi == nil {
		return errors.New("请先打开项目")
	}
	select {
	case <-s.pi.done:
		return errors.New("会话已断开，请重新打开项目")
	default:
	}
	return s.pi.Send(text)
}

// Stop waits for cancellation or closes an unresponsive owned session.
func (s *AgentService) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pi == nil {
		return nil
	}
	if err := s.pi.Stop(); err != nil {
		if closeErr := s.pi.Close(); closeErr != nil {
			return fmt.Errorf("停止失败: %v; %w", err, closeErr)
		}
		s.pi = nil
		return errors.New("任务未响应停止，已关闭会话；请重新打开项目")
	}
	return nil
}

// ChooseProject opens a native single-folder picker without starting a session.
func (s *AgentService) ChooseProject(ctx context.Context) (string, error) {
	directory, err := applicationRoot()
	if err != nil {
		return "", err
	}
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "选择 Git 项目", DefaultPath: directory, ButtonLabel: "选择项目", Directory: true, Multiple: false})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], nil
}

// CloseProject ends the current idle session before returning to project selection.
func (s *AgentService) CloseProject() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pi != nil {
		if s.pi.Busy() {
			return errors.New("请先停止当前任务，再更换项目")
		}
		if err := s.pi.Close(); err != nil {
			return err
		}
		s.pi = nil
	}
	s.emit(AgentEvent{Source: "app", Type: "project_closed", Text: "请选择项目"})
	return nil
}

func (s *AgentService) close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pi != nil {
		return s.pi.Close()
	}
	return nil
}
