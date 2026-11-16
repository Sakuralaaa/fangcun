package feed

import (
	"encoding/json"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginapi"
)

const (
	codexSecret = "codex-access-SECRET-123"
	agSecret    = "ya29.ANTIGRAVITY-SECRET"
	refreshTok  = "refresh-SECRET-456"
)

type fakeHost struct {
	calls []string
}

func (f *fakeHost) AuthList() ([]pluginapi.HostAuthFileEntry, error) {
	return []pluginapi.HostAuthFileEntry{
		{AuthIndex: "a1", Provider: "codex", Email: "dev@example.com", Path: "/tmp/x/codex-dev.json"},
		{AuthIndex: "a2", Provider: "antigravity", Email: "ag@example.com"},
		{AuthIndex: "a3", Provider: "claude", Email: "skip@example.com"},
		{AuthIndex: "a4", Provider: "codex", Email: "off@example.com", Disabled: true},
	}, nil
}

func (f *fakeHost) AuthJSON(idx string) ([]byte, error) {
	switch idx {
	case "a1":
		return []byte(`{"type":"codex","access_token":"` + codexSecret + `","refresh_token":"` + refreshTok + `","account_id":"acc-1","email":"dev@example.com"}`), nil
	case "a2":
		return []byte(`{"type":"antigravity","access_token":"` + agSecret + `","refresh_token":"` + refreshTok + `","project_id":"proj-9"}`), nil
	}
	return nil, nil
}

func (f *fakeHost) HTTP(method, u string, h http.Header, body []byte) (int, http.Header, []byte, error) {
	f.calls = append(f.calls, method+" "+u+" "+h.Get("Authorization"))
	switch {
	case strings.Contains(u, "wham/usage"):
		if h.Get("Chatgpt-Account-Id") != "acc-1" {
			return 400, nil, nil, nil
		}
		return 200, nil, []byte(`{"plan_type":"plus","rate_limit":{"allowed":true,"limit_reached":false,
			"primary_window":{"used_percent":62,"limit_window_seconds":18000,"reset_at":1763190000},
			"secondary_window":{"used_percent":38.25,"limit_window_seconds":604800,"reset_after_seconds":3600}}}`), nil
	case strings.Contains(u, "loadCodeAssist"):
		return 200, nil, []byte(`{"currentTier":{"id":"free-tier"},"paidTier":{"id":"g1-pro-tier","name":"Google AI Pro"}}`), nil
	case strings.Contains(u, "daily-cloudcode-pa.googleapis.com") && strings.Contains(u, "QuotaSummary"):
		if !strings.Contains(string(body), "proj-9") {
			return 400, nil, nil, nil
		}
		return 200, nil, []byte(`{"groups":[{"displayName":"Gemini Pro","buckets":[{"window":"5h","remainingFraction":0.25,"resetTime":"2026-11-15T08:00:00Z"},{"window":"weekly","remainingFraction":1}]},{"displayName":"Claude","buckets":[{"window":"5h","remainingFraction":0}]}]}`), nil
	}
	return 404, nil, nil, nil
}

func setup(t *testing.T) *fakeHost {
	t.Helper()
	f := &fakeHost{}
	SetHost(f)
	resetTokenState(filepath.Join(t.TempDir(), tokenFileName))
	resetCache()
	nowFn = func() time.Time { return time.Date(2026, 11, 15, 3, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { SetHost(rpcHost{}); nowFn = time.Now })
	return f
}

func TestBuildReadsCodexAndAntigravityOnly(t *testing.T) {
	f := setup(t)
	snap, err := Build()
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Accounts) != 3 {
		t.Fatalf("want 3 accounts (2 codex, 1 antigravity), got %d", len(snap.Accounts))
	}
	by := map[string]Account{}
	for _, a := range snap.Accounts {
		by[a.ID] = a
	}
	c := by["a1"]
	if c.Plan != "plus" || c.Status != "ok" || len(c.Windows) != 2 {
		t.Fatalf("codex: %+v", c)
	}
	if c.Windows[0].Key != "5h" || c.Windows[0].UsedPct != 62 || c.Windows[0].ResetAt != "2025-11-15T07:00:00Z" {
		t.Fatalf("codex 5h: %+v", c.Windows[0])
	}
	if c.Windows[1].Key != "week" || c.Windows[1].UsedPct != 38.3 || c.Windows[1].ResetAt != "2026-11-15T04:00:00Z" {
		t.Fatalf("codex week: %+v", c.Windows[1])
	}
	if by["a4"].Status != "disabled" {
		t.Fatalf("disabled: %+v", by["a4"])
	}
	g := by["a2"]
	if g.Plan != "pro" || g.Status != "ok" || len(g.Windows) != 3 {
		t.Fatalf("antigravity: %+v", g)
	}
	if g.Windows[0].Key != "Claude/5h" || g.Windows[0].UsedPct != 100 || g.Windows[1].Key != "Gemini Pro/5h" || g.Windows[1].UsedPct != 75 {
		t.Fatalf("antigravity windows: %+v", g.Windows)
	}
	// the disabled credential is never read
	for _, c := range f.calls {
		if strings.Contains(c, "off@") {
			t.Fatal("disabled credential was used")
		}
	}
}

func TestFeedNeverCarriesCredentials(t *testing.T) {
	setup(t)
	tok, _ := CurrentToken()
	r := Route(pluginapi.ManagementRequest{Method: "GET", Path: "/v0/resource/plugins/fangcun/feed", Headers: http.Header{"Authorization": {"Bearer " + tok.Token}}, Query: url.Values{}})
	if r["StatusCode"] != 200 {
		t.Fatalf("status %v %s", r["StatusCode"], r["Body"])
	}
	body := string(r["Body"].([]byte))
	for _, s := range []string{codexSecret, agSecret, refreshTok, "acc-1", "proj-9", "/tmp/x"} {
		if strings.Contains(body, s) {
			t.Fatalf("feed leaks %q: %s", s, body)
		}
	}
	var snap Snapshot
	if err := json.Unmarshal([]byte(body), &snap); err != nil || snap.V != 1 {
		t.Fatalf("bad snapshot: %v %s", err, body)
	}
}

func TestFeedRequiresToken(t *testing.T) {
	setup(t)
	tok, _ := CurrentToken()
	for _, h := range []http.Header{
		{},
		{"Authorization": {"Bearer fcq_wrong"}},
		{"Authorization": {"Bearer " + tok.Token + "x"}},
		{"Authorization": {"Basic " + tok.Token}},
	} {
		r := Route(pluginapi.ManagementRequest{Method: "GET", Path: "/v0/resource/plugins/fangcun/feed", Headers: h, Query: url.Values{}})
		if r["StatusCode"] != 401 {
			t.Fatalf("want 401 for %v, got %v", h, r["StatusCode"])
		}
	}
	// a token in the query string is ignored
	r := Route(pluginapi.ManagementRequest{Method: "GET", Path: "/v0/resource/plugins/fangcun/feed", Headers: http.Header{}, Query: url.Values{"token": {tok.Token}}})
	if r["StatusCode"] != 401 {
		t.Fatal("query token accepted")
	}
	// X-Fangcun-Token works too
	r = Route(pluginapi.ManagementRequest{Method: "GET", Path: "/v0/resource/plugins/fangcun/feed", Headers: http.Header{"X-Fangcun-Token": {tok.Token}}, Query: url.Values{}})
	if r["StatusCode"] != 200 {
		t.Fatalf("header token: %v", r["StatusCode"])
	}
}

func TestRotateInvalidatesOldToken(t *testing.T) {
	setup(t)
	old, _ := CurrentToken()
	if !strings.HasPrefix(old.Token, TokenPrefix) || len(old.Token) < 40 {
		t.Fatalf("token shape: %q", old.Token)
	}
	again, _ := CurrentToken()
	if again.Token != old.Token {
		t.Fatal("token not stable")
	}
	nw, err := RotateToken()
	if err != nil || nw.Token == old.Token {
		t.Fatal("rotate failed")
	}
	if CheckToken(old.Token) || !CheckToken(nw.Token) {
		t.Fatal("old token still accepted")
	}
	// survives a reload from disk
	path := tokenState.path
	resetTokenState(path)
	if !CheckToken(nw.Token) {
		t.Fatal("token not persisted")
	}
}

func TestCacheAndForceGap(t *testing.T) {
	f := setup(t)
	if _, err := Get(false); err != nil {
		t.Fatal(err)
	}
	n := len(f.calls)
	_, _ = Get(true) // within ForceGap: cached
	if len(f.calls) != n {
		t.Fatal("forced refresh inside the gap hit upstream")
	}
	base := nowFn()
	nowFn = func() time.Time { return base.Add(2 * time.Minute) }
	_, _ = Get(false) // inside TTL: cached
	if len(f.calls) != n {
		t.Fatal("refresh inside TTL")
	}
	_, _ = Get(true) // forced, past the gap
	if len(f.calls) == n {
		t.Fatal("forced refresh ignored")
	}
}

func TestManagementConnection(t *testing.T) {
	setup(t)
	setResourceBase("/v0/resource/plugins/fangcun-x/")
	defer setResourceBase("")
	r := Route(pluginapi.ManagementRequest{Method: "GET", Path: "/v0/management/fangcun/connection"})
	var d map[string]string
	_ = json.Unmarshal(r["Body"].([]byte), &d)
	if r["StatusCode"] != 200 || !strings.HasPrefix(d["token"], TokenPrefix) || d["feedPath"] != "/v0/resource/plugins/fangcun-x/feed" {
		t.Fatalf("connection: %v %v", r["StatusCode"], d)
	}
	if r := Route(pluginapi.ManagementRequest{Method: "GET", Path: "/v0/management/fangcun/token/rotate"}); r["StatusCode"] != 404 {
		t.Fatal("rotate must be POST")
	}
}

func TestCodexLimitReached(t *testing.T) {
	a := Account{}
	ParseCodexUsage(&a, []byte(`{"rate_limit":{"allowed":false,"limit_reached":true,"primary_window":{"limit_window_seconds":18000,"reset_after_seconds":60}}}`), time.Unix(0, 0))
	if a.Status != "limited" || len(a.Windows) != 1 || a.Windows[0].UsedPct != 100 {
		t.Fatalf("%+v", a)
	}
}

func TestRegisterAdvertisesManagementOnly(t *testing.T) {
	raw, err := Handle("plugin.register", []byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	var env struct {
		OK     bool         `json:"ok"`
		Result registration `json:"result"`
	}
	_ = json.Unmarshal(raw, &env)
	if !env.OK || !env.Result.Capabilities.ManagementAPI {
		t.Fatalf("%s", raw)
	}
}
