// IRON ECHO desktop launcher: one executable that carries the whole game (Build/Web/standalone, embedded at build
// time), serves it on 127.0.0.1 and opens it in an app window of Edge or Chrome (no tabs, no address bar). Nothing is
// downloaded at run time: three.js, MediaPipe and the pose model are inside. Built by Tools/Build/Desktop/build_desktop.py.
//
// The port is fixed (47310) so the page origin is stable: settings and the camera permission survive restarts. A
// dedicated browser profile in %LOCALAPPDATA%\IronEcho keeps the game apart from the user's own browsing.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed all:game
var gameFiles embed.FS

const (
	preferredPort = 47310
	pingPath      = "/__ironecho"
	pingReply     = "IRON ECHO"
)

var version = "dev" // set by -ldflags "-X main.version=..."

func main() {
	serve := flag.String("serve", "", "only serve the game on this address (for example 127.0.0.1:8799), no window")
	flag.StringVar(&phoneAddr, "phone-addr", "", "listen address for the phone camera (default 0.0.0.0:47311)")
	flag.Parse()

	for ext, typ := range map[string]string{".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm",
		".glb": "model/gltf-binary", ".task": "application/octet-stream", ".woff2": "font/woff2", ".css": "text/css",
		".jpg": "image/jpeg", ".html": "text/html; charset=utf-8"} {
		_ = mime.AddExtensionType(ext, typ)
	}
	game, err := fs.Sub(gameFiles, "game")
	if err != nil {
		fatal("Повреждённая сборка: нет файлов игры.\n\n" + err.Error())
	}

	if *serve != "" {
		ln, err := net.Listen("tcp", *serve)
		if err != nil {
			fatal(err.Error())
		}
		fmt.Printf("IRON ECHO %s: http://%s/\n", version, ln.Addr())
		_ = http.Serve(ln, handler(game))
		return
	}

	url, ln := listen()
	if ln != nil {
		go func() { _ = http.Serve(ln, handler(game)) }()
	}
	browser := findBrowser()
	if browser == "" {
		openDefault(url)
		if ln != nil {
			message("IRON ECHO", "Не найден Microsoft Edge или Google Chrome, игра открыта в браузере по умолчанию:\n"+url+
				"\n\nНажмите OK, когда закончите играть.")
		}
		return
	}
	profile := filepath.Join(dataDir(), "browser")
	cmd := exec.Command(browser,
		"--app="+url,
		"--user-data-dir="+profile,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=Translate,msUndersideButton,msEdgeSidebarV2",
		"--autoplay-policy=no-user-gesture-required",
		"--start-maximized",
	)
	if err := cmd.Start(); err != nil {
		openDefault(url)
		if ln != nil {
			message("IRON ECHO", "Не удалось открыть окно игры ("+err.Error()+"), игра открыта в браузере:\n"+url+
				"\n\nНажмите OK, когда закончите играть.")
		}
		return
	}
	_ = cmd.Wait()
	if ln == nil {
		return // another IRON ECHO serves the game
	}
	// The browser may hand the window to an already running instance of the same profile and exit at once: keep
	// serving while any page of ours is still open (it polls the ping path).
	for lastPing.Load() > 0 && time.Since(time.Unix(0, lastPing.Load())) < 10*time.Second {
		time.Sleep(2 * time.Second)
	}
}

// listen takes the fixed port; if it is busy because IRON ECHO already runs, reuse that server; otherwise any port.
func listen() (string, net.Listener) {
	addr := fmt.Sprintf("127.0.0.1:%d", preferredPort)
	if ln, err := net.Listen("tcp", addr); err == nil {
		return "http://" + addr + "/", ln
	}
	client := http.Client{Timeout: 2 * time.Second}
	if res, err := client.Get("http://" + addr + pingPath); err == nil {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 64))
		res.Body.Close()
		if strings.TrimSpace(string(body)) == pingReply {
			return "http://" + addr + "/", nil
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fatal("Не удалось открыть локальный порт: " + err.Error())
	}
	return "http://" + ln.Addr().String() + "/", ln
}

func handler(game fs.FS) http.Handler {
	files := http.FileServer(http.FS(game))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case pingPath + "/phone":
			phoneInfo(w, r)
			return
		case pingPath + "/phone/frame":
			phoneFrame(w, r)
			return
		}
		if r.URL.Path == pingPath {
			lastPing.Store(time.Now().UnixNano())
			_, _ = io.WriteString(w, pingReply)
			return
		}
		h := w.Header()
		h.Set("Cache-Control", "no-cache")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Permissions-Policy", "camera=(self), microphone=()")
		files.ServeHTTP(w, r)
	})
}

func dataDir() string {
	base, err := os.UserCacheDir() // %LOCALAPPDATA% on Windows
	if err != nil {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "IronEcho")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func findBrowser() string {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
			root := os.Getenv(env)
			if root == "" {
				continue
			}
			candidates = append(candidates,
				filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
				filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe"))
		}
	case "darwin":
		candidates = []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"}
	default:
		for _, name := range []string{"google-chrome", "chromium", "chromium-browser", "microsoft-edge"} {
			if p, err := exec.LookPath(name); err == nil {
				candidates = append(candidates, p)
			}
		}
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func openDefault(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func fatal(text string) {
	message("IRON ECHO — ошибка", text)
	os.Exit(1)
}

// lastPing: when an open game page last called pingPath (the page polls it while it runs on 127.0.0.1).
var lastPing atomic.Int64
