package feed

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginapi"
)

// FeedVersion is the shape of the JSON the feed returns.
const FeedVersion = 1

// Window is one quota window of an account.
type Window struct {
	// Key is stable across reads: "5h", "week", "month", "day" or a provider's own window name,
	// prefixed with the group for grouped quotas ("Gemini Pro/5h").
	Key string `json:"key"`
	// Group is the provider's quota group ("" for an account's main limit).
	Group string `json:"group,omitempty"`
	// Window is the period: 5h, week, month, day, or the provider's raw name.
	Window  string  `json:"window"`
	UsedPct float64 `json:"usedPct"`
	ResetAt string  `json:"resetAt,omitempty"`
}

// Account is one credential in the pool, with no secret of any kind.
type Account struct {
	ID       string   `json:"id"`
	Provider string   `json:"provider"`
	Email    string   `json:"email,omitempty"`
	Label    string   `json:"label,omitempty"`
	Note     string   `json:"note,omitempty"`
	Plan     string   `json:"plan,omitempty"`
	Status   string   `json:"status"`
	Message  string   `json:"message,omitempty"`
	Windows  []Window `json:"windows"`
	Observed string   `json:"observedAt,omitempty"`
}

// Snapshot is what the feed returns.
type Snapshot struct {
	V          int       `json:"v"`
	Plugin     string    `json:"plugin"`
	Version    string    `json:"version"`
	ObservedAt string    `json:"observedAt"`
	Accounts   []Account `json:"accounts"`
}

// Providers read by the feed.
var supported = map[string]bool{"codex": true, "antigravity": true}

const (
	codexUsageURL        = "https://chatgpt.com/backend-api/wham/usage"
	codexUserAgent       = "codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)"
	antigravityAssistURL = "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
	antigravityUserAgent = "antigravity/hub/2.23.0 darwin/arm64"
)

var antigravityQuotaURLs = []string{
	"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
	"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
	"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
}

// ---- cache ----

var cache struct {
	sync.Mutex
	snap     *Snapshot
	at       time.Time
	inflight chan struct{}
}

// TTL is how long a read is reused; ForceGap is the least time between forced refreshes.
var (
	TTL      = 5 * time.Minute
	ForceGap = 60 * time.Second
	nowFn    = time.Now
)

// Get returns a snapshot no older than TTL (force: as fresh as ForceGap allows).
func Get(force bool) (*Snapshot, error) {
	cache.Lock()
	age := nowFn().Sub(cache.at)
	if cache.snap != nil && (age < ForceGap || (!force && age < TTL)) {
		s := cache.snap
		cache.Unlock()
		return s, nil
	}
	if ch := cache.inflight; ch != nil {
		cache.Unlock()
		<-ch
		cache.Lock()
		s := cache.snap
		cache.Unlock()
		if s == nil {
			return nil, fmt.Errorf("read failed")
		}
		return s, nil
	}
	ch := make(chan struct{})
	cache.inflight = ch
	cache.Unlock()

	snap, err := Build()

	cache.Lock()
	if err == nil {
		cache.snap = snap
		cache.at = nowFn()
	}
	cache.inflight = nil
	close(ch)
	cache.Unlock()
	return snap, err
}

func resetCache() {
	cache.Lock()
	cache.snap = nil
	cache.at = time.Time{}
	cache.Unlock()
}

// Build reads every Codex and Antigravity credential's quota now.
func Build() (*Snapshot, error) {
	entries, err := host().AuthList()
	if err != nil {
		return nil, err
	}
	var picked []pluginapi.HostAuthFileEntry
	for _, e := range entries {
		if supported[providerOf(e)] {
			picked = append(picked, e)
		}
	}
	out := make([]Account, len(picked))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, e := range picked {
		wg.Add(1)
		go func(i int, e pluginapi.HostAuthFileEntry) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			out[i] = readAccount(e)
		}(i, e)
	}
	wg.Wait()
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Provider != out[j].Provider {
			return out[i].Provider < out[j].Provider
		}
		return out[i].Email < out[j].Email
	})
	return &Snapshot{V: FeedVersion, Plugin: "fangcun", Version: Version, ObservedAt: nowFn().UTC().Format(time.RFC3339), Accounts: out}, nil
}

func providerOf(e pluginapi.HostAuthFileEntry) string {
	p := strings.ToLower(strings.TrimSpace(e.Provider))
	if p == "" {
		p = strings.ToLower(strings.TrimSpace(e.Type))
	}
	return p
}

func readAccount(e pluginapi.HostAuthFileEntry) (a Account) {
	a = Account{ID: e.AuthIndex, Provider: providerOf(e), Email: strings.TrimSpace(e.Email), Label: clip(e.Label, 120), Note: clip(e.Note, 200), Windows: []Window{}, Observed: nowFn().UTC().Format(time.RFC3339)}
	if a.ID == "" {
		a.ID = shortHash(e.ID + "|" + e.Name)
	}
	defer func() {
		if r := recover(); r != nil {
			a.Status, a.Message = "error", "read failed"
		}
	}()
	if e.Disabled {
		a.Status = "disabled"
		return a
	}
	raw, err := host().AuthJSON(e.AuthIndex)
	if err != nil {
		a.Status, a.Message = "error", clip(err.Error(), 200)
		return a
	}
	var cred map[string]any
	if json.Unmarshal(raw, &cred) != nil {
		a.Status, a.Message = "error", "credential file is not JSON"
		return a
	}
	if a.Email == "" {
		a.Email = str(cred["email"])
	}
	switch a.Provider {
	case "codex":
		readCodex(&a, cred)
	case "antigravity":
		readAntigravity(&a, cred)
	}
	if a.Status == "ok" && (e.Unavailable || strings.EqualFold(e.Status, "error")) {
		a.Status = "cooling"
		if msg := clip(e.StatusMessage, 200); msg != "" {
			a.Message = msg
		}
		if !e.NextRetryAfter.IsZero() && a.Message == "" {
			a.Message = "retry after " + e.NextRetryAfter.UTC().Format(time.RFC3339)
		}
	}
	return a
}

func authHeaders(token string) http.Header {
	h := http.Header{}
	h.Set("Authorization", "Bearer "+token)
	h.Set("Content-Type", "application/json")
	h.Set("Accept", "application/json")
	return h
}

func statusFor(code int) (string, string) {
	switch {
	case code == 401:
		return "expired", "credential rejected (401)"
	case code == 403:
		return "error", "forbidden (403)"
	case code == 429:
		return "error", "rate limited (429)"
	default:
		return "error", fmt.Sprintf("HTTP %d", code)
	}
}

// ---- Codex ----

func readCodex(a *Account, cred map[string]any) {
	token := str(cred["access_token"])
	if token == "" {
		a.Status, a.Message = "error", "no access token"
		return
	}
	h := authHeaders(token)
	h.Set("User-Agent", codexUserAgent)
	accountID := str(cred["account_id"])
	if accountID == "" {
		accountID = jwtClaim(str(cred["id_token"]), "chatgpt_account_id")
	}
	if accountID != "" {
		h.Set("Chatgpt-Account-Id", accountID)
	}
	if a.Plan == "" {
		a.Plan = jwtClaim(str(cred["id_token"]), "chatgpt_plan_type")
	}
	code, _, body, err := host().HTTP("GET", codexUsageURL, h, nil)
	if err != nil {
		a.Status, a.Message = "error", clip(err.Error(), 200)
		return
	}
	if code < 200 || code >= 300 {
		a.Status, a.Message = statusFor(code)
		return
	}
	ParseCodexUsage(a, body, nowFn())
}

// ParseCodexUsage fills plan, windows and status from a wham/usage body.
func ParseCodexUsage(a *Account, body []byte, now time.Time) {
	var p map[string]any
	if json.Unmarshal(body, &p) != nil {
		a.Status, a.Message = "error", "unreadable usage"
		return
	}
	if plan := str(first(p, "plan_type", "planType")); plan != "" {
		a.Plan = plan
	}
	limited := false
	addLimit := func(group string, rl map[string]any) {
		if rl == nil {
			return
		}
		reached := truthy(first(rl, "limit_reached", "limitReached")) || first(rl, "allowed") == false
		if reached && group == "" {
			limited = true
		}
		prim, _ := first(rl, "primary_window", "primaryWindow").(map[string]any)
		sec, _ := first(rl, "secondary_window", "secondaryWindow").(map[string]any)
		for i, w := range []map[string]any{prim, sec} {
			if w == nil {
				continue
			}
			win := codexWindowName(num(first(w, "limit_window_seconds", "limitWindowSeconds")), i)
			used := num(first(w, "used_percent", "usedPercent"))
			if math.IsNaN(used) {
				if reached {
					used = 100
				} else {
					continue
				}
			}
			a.Windows = append(a.Windows, Window{Key: key(group, win), Group: group, Window: win, UsedPct: round1(clamp(used)), ResetAt: codexReset(w, now)})
		}
	}
	rl, _ := first(p, "rate_limit", "rateLimit").(map[string]any)
	addLimit("", rl)
	if extra, ok := first(p, "additional_rate_limits", "additionalRateLimits").([]any); ok {
		for _, x := range extra {
			m, _ := x.(map[string]any)
			if m == nil {
				continue
			}
			name := str(first(m, "limit_name", "limitName"))
			if name == "" {
				name = str(first(m, "metered_feature", "meteredFeature"))
			}
			if name == "" {
				continue
			}
			sub, _ := first(m, "rate_limit", "rateLimit").(map[string]any)
			addLimit(clip(name, 60), sub)
		}
	}
	if len(a.Windows) == 0 && rl == nil {
		a.Status, a.Message = "error", "no usage windows"
		return
	}
	a.Status = "ok"
	for _, w := range a.Windows {
		if w.Group == "" && w.UsedPct >= 100 {
			limited = true
		}
	}
	if limited {
		a.Status = "limited"
	}
}

func codexWindowName(seconds float64, order int) string {
	switch {
	case seconds == 18000:
		return "5h"
	case seconds == 604800:
		return "week"
	case seconds == 86400:
		return "day"
	case seconds >= 28*86400 && seconds <= 31*86400:
		return "month"
	case !math.IsNaN(seconds) && seconds > 0:
		return strconv.Itoa(int(seconds/3600)) + "h"
	case order == 0:
		return "5h"
	default:
		return "week"
	}
}

func codexReset(w map[string]any, now time.Time) string {
	if at := num(first(w, "reset_at", "resetAt")); !math.IsNaN(at) && at > 0 {
		if at > 1e12 {
			at /= 1000
		}
		return time.Unix(int64(at), 0).UTC().Format(time.RFC3339)
	}
	if s, ok := first(w, "reset_at", "resetAt").(string); ok {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
	}
	if after := num(first(w, "reset_after_seconds", "resetAfterSeconds")); !math.IsNaN(after) && after >= 0 {
		return now.Add(time.Duration(after) * time.Second).UTC().Format(time.RFC3339)
	}
	return ""
}

// ---- Antigravity ----

func readAntigravity(a *Account, cred map[string]any) {
	token := str(cred["access_token"])
	if token == "" {
		a.Status, a.Message = "error", "no access token"
		return
	}
	project := str(first(cred, "project_id", "projectId"))
	if project == "" {
		if inst, ok := cred["installed"].(map[string]any); ok {
			project = str(first(inst, "project_id", "projectId"))
		}
	}
	h := authHeaders(token)
	h.Set("User-Agent", antigravityUserAgent)

	if code, _, body, err := host().HTTP("POST", antigravityAssistURL, h, []byte(`{"metadata":{"ideType":"ANTIGRAVITY"}}`)); err == nil && code >= 200 && code < 300 {
		a.Plan = ParseAntigravityPlan(body)
		if project == "" {
			var p map[string]any
			if json.Unmarshal(body, &p) == nil {
				project = str(first(p, "cloudaicompanionProject", "cloudaicompanion_project"))
			}
		}
	}
	if project == "" {
		a.Status, a.Message = "error", "no project id"
		return
	}
	reqBody, _ := json.Marshal(map[string]string{"project": project})
	lastCode := 0
	var lastErr string
	ok := false
	seen := map[string]bool{}
	for _, u := range antigravityQuotaURLs {
		code, _, body, err := host().HTTP("POST", u, h, reqBody)
		if err != nil {
			lastErr = err.Error()
			continue
		}
		if code < 200 || code >= 300 {
			if lastCode == 0 || code == 401 || code == 403 {
				lastCode = code
			}
			continue
		}
		ok = true
		for _, w := range ParseAntigravityQuota(body) {
			if !seen[w.Key] {
				seen[w.Key] = true
				a.Windows = append(a.Windows, w)
			}
		}
		if hasGemini(a.Windows) {
			break
		}
	}
	if !ok {
		if lastCode != 0 {
			a.Status, a.Message = statusFor(lastCode)
		} else {
			a.Status, a.Message = "error", clip(lastErr, 200)
		}
		return
	}
	sort.SliceStable(a.Windows, func(i, j int) bool {
		if a.Windows[i].Group != a.Windows[j].Group {
			return a.Windows[i].Group < a.Windows[j].Group
		}
		return windowRank(a.Windows[i].Window) < windowRank(a.Windows[j].Window)
	})
	a.Status = "ok"
	if len(a.Windows) > 0 {
		all := true
		for _, w := range a.Windows {
			if w.UsedPct < 100 {
				all = false
			}
		}
		if all {
			a.Status = "limited"
		}
	}
}

func hasGemini(ws []Window) bool {
	for _, w := range ws {
		if strings.Contains(strings.ToLower(w.Group), "gemini") {
			return true
		}
	}
	return false
}

func windowRank(w string) int {
	switch w {
	case "5h":
		return 0
	case "day":
		return 1
	case "week":
		return 2
	case "month":
		return 3
	}
	return 4
}

// ParseAntigravityQuota turns a retrieveUserQuotaSummary body into windows.
func ParseAntigravityQuota(body []byte) []Window {
	var p map[string]any
	if json.Unmarshal(body, &p) != nil {
		return nil
	}
	groups, _ := p["groups"].([]any)
	var out []Window
	for gi, g := range groups {
		gm, _ := g.(map[string]any)
		if gm == nil {
			continue
		}
		group := clip(str(first(gm, "displayName", "display_name")), 60)
		if group == "" {
			group = fmt.Sprintf("Group %d", gi+1)
		}
		buckets, _ := gm["buckets"].([]any)
		for bi, b := range buckets {
			bm, _ := b.(map[string]any)
			if bm == nil {
				continue
			}
			frac := num(first(bm, "remainingFraction", "remaining_fraction"))
			if math.IsNaN(frac) {
				continue
			}
			if frac > 1 {
				frac /= 100
			}
			win := normWindow(str(bm["window"]))
			if win == "" {
				win = clip(str(first(bm, "displayName", "display_name", "bucketId", "bucket_id")), 40)
			}
			if win == "" {
				win = fmt.Sprintf("bucket-%d", bi+1)
			}
			reset := str(first(bm, "resetTime", "reset_time"))
			if t, err := time.Parse(time.RFC3339, reset); err == nil {
				reset = t.UTC().Format(time.RFC3339)
			}
			out = append(out, Window{Key: key(group, win), Group: group, Window: win, UsedPct: round1(clamp((1 - frac) * 100)), ResetAt: reset})
		}
	}
	return out
}

func normWindow(w string) string {
	switch strings.ToLower(strings.TrimSpace(w)) {
	case "5h", "five-hour", "five_hour", "5-hour":
		return "5h"
	case "weekly", "week", "7d":
		return "week"
	case "daily", "day", "1d":
		return "day"
	case "monthly", "month":
		return "month"
	}
	return clip(strings.TrimSpace(w), 40)
}

var antigravityPlans = map[string]string{"free-tier": "free", "g1-pro-tier": "pro", "g1-ultra-tier": "ultra", "g1-ultra-lite-tier": "ultra-lite"}

// ParseAntigravityPlan reads the paid (else current) tier from a loadCodeAssist body.
func ParseAntigravityPlan(body []byte) string {
	var p map[string]any
	if json.Unmarshal(body, &p) != nil {
		return ""
	}
	tier := func(v any) (string, string) {
		m, _ := v.(map[string]any)
		return str(m["id"]), str(m["name"])
	}
	id, name := tier(first(p, "paidTier", "paid_tier"))
	if id == "" {
		id, name = tier(first(p, "currentTier", "current_tier"))
	}
	if plan, ok := antigravityPlans[id]; ok {
		return plan
	}
	if name != "" {
		return clip(name, 40)
	}
	return clip(id, 40)
}

// ---- helpers ----

func key(group, win string) string {
	if group == "" {
		return win
	}
	return group + "/" + win
}

func first(m map[string]any, keys ...string) any {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

func str(v any) string {
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return ""
}

func num(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return f
		}
	case json.Number:
		if f, err := x.Float64(); err == nil {
			return f
		}
	}
	return math.NaN()
}

func truthy(v any) bool { b, _ := v.(bool); return b }

func clamp(f float64) float64 { return math.Max(0, math.Min(100, f)) }

func round1(f float64) float64 { return math.Round(f*10) / 10 }

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) > n {
		return string([]rune(s)[:n])
	}
	return s
}

func shortHash(s string) string {
	var h uint64 = 1469598103934665603
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return strconv.FormatUint(h, 16)
}

// jwtClaim reads one claim of the OpenAI auth namespace from an id_token (no verification; display only).
func jwtClaim(tok, claim string) string {
	parts := strings.Split(tok, ".")
	if len(parts) < 2 {
		return ""
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return ""
	}
	var c map[string]any
	if json.Unmarshal(raw, &c) != nil {
		return ""
	}
	if ns, ok := c["https://api.openai.com/auth"].(map[string]any); ok {
		if v := str(ns[claim]); v != "" {
			return v
		}
	}
	return str(c[claim])
}
