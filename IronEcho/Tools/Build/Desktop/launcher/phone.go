package main

// Phone as the camera. A phone on the same Wi-Fi opens https://<this PC>:47311/phone?k=<key> (the game shows it as a QR
// code), streams its camera as JPEG frames to this process, and the game page (served on 127.0.0.1) long-polls the
// newest frame and runs pose tracking on it exactly like a webcam frame. HTTPS is required because phone browsers only
// open the camera on secure pages; the certificate is self-signed for the PC's LAN addresses and kept in
// %LOCALAPPDATA%\IronEcho, so the browser warning has to be accepted once per address. The LAN listener starts only
// when the player picks the phone camera (that is also when Windows asks to allow it through the firewall).

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed phone.html
var phonePage []byte

const (
	phonePort     = 47311
	maxFrameBytes = 3 << 20
)

var phoneAddr = "" // listen address override (tests); default 0.0.0.0:47311

type frameRelay struct {
	mu   sync.Mutex
	cond *sync.Cond
	data []byte
	seq  uint64
	at   time.Time
}

var relay = func() *frameRelay { r := &frameRelay{}; r.cond = sync.NewCond(&r.mu); return r }()

func (r *frameRelay) put(b []byte) {
	r.mu.Lock()
	r.data = b
	r.seq++
	r.at = time.Now()
	r.mu.Unlock()
	r.cond.Broadcast()
}

// next waits up to `wait` for a frame newer than `after`.
func (r *frameRelay) next(after uint64, wait time.Duration) ([]byte, uint64, bool) {
	deadline := time.Now().Add(wait)
	timer := time.AfterFunc(wait, func() { r.cond.Broadcast() })
	defer timer.Stop()
	r.mu.Lock()
	defer r.mu.Unlock()
	for r.seq <= after || r.data == nil {
		if !time.Now().Before(deadline) {
			return nil, r.seq, false
		}
		r.cond.Wait()
	}
	return r.data, r.seq, true
}

var phone struct {
	once  sync.Once
	err   error
	key   string
	port  int
	hosts []string
}

func startPhoneServer() error {
	phone.once.Do(func() {
		k := make([]byte, 9)
		_, _ = rand.Read(k)
		phone.key = hex.EncodeToString(k)
		phone.hosts = lanAddresses()
		cert, err := phoneCertificate(phone.hosts)
		if err != nil {
			phone.err = fmt.Errorf("сертификат: %w", err)
			return
		}
		addr := phoneAddr
		if addr == "" {
			addr = fmt.Sprintf("0.0.0.0:%d", phonePort)
		}
		ln, err := net.Listen("tcp", addr)
		if err != nil && phoneAddr == "" {
			ln, err = net.Listen("tcp", "0.0.0.0:0")
		}
		if err != nil {
			phone.err = err
			return
		}
		phone.port = ln.Addr().(*net.TCPAddr).Port
		srv := &http.Server{Handler: phoneHandler(), TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12},
			ReadHeaderTimeout: 10 * time.Second}
		go func() { _ = srv.ServeTLS(ln, "", "") }()
	})
	return phone.err
}

func phoneHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/phone", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(phonePage)
	})
	mux.HandleFunc("/phone/frame", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Query().Get("k") != phone.key {
			http.Error(w, "ссылка устарела: отсканируй QR-код заново", http.StatusForbidden)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, maxFrameBytes+1))
		if err != nil || len(b) == 0 || len(b) > maxFrameBytes {
			http.Error(w, "bad frame", http.StatusBadRequest)
			return
		}
		relay.put(b)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/phone?"+r.URL.RawQuery, http.StatusFound)
	})
	return mux
}

// phoneInfo answers the game page: where the phone should connect.
func phoneInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err := startPhoneServer(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	urls := []string{}
	for _, h := range phone.hosts {
		urls = append(urls, fmt.Sprintf("https://%s:%d/phone?k=%s", h, phone.port, phone.key))
	}
	relay.mu.Lock()
	age := -1.0
	if !relay.at.IsZero() {
		age = time.Since(relay.at).Seconds()
	}
	relay.mu.Unlock()
	_ = json.NewEncoder(w).Encode(map[string]any{"urls": urls, "port": phone.port, "lastFrameAge": age})
}

// phoneFrame answers the game page with the newest phone frame (long poll).
func phoneFrame(w http.ResponseWriter, r *http.Request) {
	after, _ := strconv.ParseUint(r.URL.Query().Get("after"), 10, 64)
	waitMs, _ := strconv.Atoi(r.URL.Query().Get("wait"))
	if waitMs <= 0 || waitMs > 10000 {
		waitMs = 1500
	}
	data, seq, ok := relay.next(after, time.Duration(waitMs)*time.Millisecond)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Seq", strconv.FormatUint(seq, 10))
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	_, _ = w.Write(data)
}

// lanAddresses: IPv4 addresses the phone can reach, private (home) networks first; any other interface address only
// when there is no private one. An explicit -phone-addr host wins (tests).
func lanAddresses() []string {
	if h, _, err := net.SplitHostPort(phoneAddr); err == nil && h != "" && h != "0.0.0.0" {
		return []string{h}
	}
	var out, other []string
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipn.IP.To4()
			if ip == nil || ip.IsLinkLocalUnicast() {
				continue
			}
			if ip.IsPrivate() {
				out = append(out, ip.String())
			} else {
				other = append(other, ip.String())
			}
		}
	}
	rank := func(s string) int {
		switch {
		case strings.HasPrefix(s, "192.168."):
			return 0
		case strings.HasPrefix(s, "10."):
			return 1
		default:
			return 2
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return rank(out[i]) < rank(out[j]) })
	if len(out) == 0 {
		return other
	}
	return out
}

// phoneCertificate loads the saved self-signed certificate, or makes a new one when it is missing, expiring or does not
// cover the current addresses.
func phoneCertificate(hosts []string) (tls.Certificate, error) {
	dir := dataDir()
	certPath := filepath.Join(dir, "phone-cert.pem")
	keyPath := filepath.Join(dir, "phone-key.pem")
	if c, err := tls.LoadX509KeyPair(certPath, keyPath); err == nil {
		if leaf, err := x509.ParseCertificate(c.Certificate[0]); err == nil && time.Until(leaf.NotAfter) > 30*24*time.Hour && covers(leaf, hosts) {
			return c, nil
		}
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 62))
	tpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "IRON ECHO (this computer)", Organization: []string{"IRON ECHO"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().AddDate(2, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.IPv4(127, 0, 0, 1)},
	}
	for _, h := range hosts {
		tpl.IPAddresses = append(tpl.IPAddresses, net.ParseIP(h))
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}
	kb, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return tls.Certificate{}, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb})
	_ = os.WriteFile(certPath, certPEM, 0o600)
	_ = os.WriteFile(keyPath, keyPEM, 0o600)
	return tls.X509KeyPair(certPEM, keyPEM)
}

func covers(c *x509.Certificate, hosts []string) bool {
	for _, h := range hosts {
		found := false
		for _, ip := range c.IPAddresses {
			if ip.String() == h {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
