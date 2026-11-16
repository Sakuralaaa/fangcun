package feed

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginabi"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginapi"
)

// Version is this build's version (set with -ldflags "-X .../feed.Version=x.y.z").
var Version = "0.0.0-dev"

//go:embed web/index.html
var pageHTML []byte

type envelope struct {
	OK     bool             `json:"ok"`
	Result json.RawMessage  `json:"result,omitempty"`
	Error  *pluginabi.Error `json:"error,omitempty"`
}

type capabilities struct {
	ManagementAPI bool `json:"management_api"`
}

type registration struct {
	SchemaVersion uint32             `json:"schema_version"`
	Metadata      pluginapi.Metadata `json:"metadata"`
	Capabilities  capabilities       `json:"capabilities"`
}

func pluginRegistration() registration {
	return registration{
		SchemaVersion: pluginabi.SchemaVersion,
		Metadata: pluginapi.Metadata{
			Name:             "方寸 Fangcun",
			Version:          Version,
			Author:           "Sakuralaaa",
			GitHubRepository: "https://github.com/Sakuralaaa/fangcun",
		},
		Capabilities: capabilities{ManagementAPI: true},
	}
}

// Handle answers one RPC method.
func Handle(method string, req []byte) ([]byte, error) {
	out, err := handle(method, req)
	if err != nil {
		var pe *pluginabi.Error
		if errors.As(err, &pe) {
			raw, _ := json.Marshal(envelope{OK: false, Error: pe})
			return raw, nil
		}
		raw, _ := json.Marshal(envelope{OK: false, Error: &pluginabi.Error{Code: "plugin_error", Message: err.Error()}})
		return raw, nil
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	return json.Marshal(envelope{OK: true, Result: raw})
}

func handle(method string, req []byte) (any, error) {
	switch method {
	case pluginabi.MethodPluginRegister, pluginabi.MethodPluginReconfigure:
		return pluginRegistration(), nil
	case pluginabi.MethodPluginQuiesce, pluginabi.MethodPluginShutdown:
		return struct{}{}, nil
	case pluginabi.MethodManagementRegister:
		var r pluginapi.ManagementRegistrationRequest
		if len(req) > 0 {
			_ = json.Unmarshal(req, &r)
		}
		if r.ResourceBasePath != "" {
			setResourceBase(r.ResourceBasePath)
		}
		return managementRoutes(), nil
	case pluginabi.MethodManagementHandle:
		var r pluginapi.ManagementRequest
		if err := json.Unmarshal(req, &r); err != nil {
			return reply(400, map[string]string{"error": "bad request"}), nil
		}
		return Route(r), nil
	}
	return nil, &pluginabi.Error{Code: "unknown_method", Message: fmt.Sprintf("unknown method: %s", method)}
}

// ---- routes ----

// Management routes (behind CLIProxyAPI's management key) give the panel the
// token and let it make a new one. The feed itself is a resource route: CLIProxyAPI
// does not authenticate resources, so the feed checks its own token and answers
// nothing without it. The panel page is a resource too and holds no data.
const (
	mgmtBase     = "fangcun/"
	pathPanel    = "/index.html"
	pathFeed     = "/feed"
	pathConn     = mgmtBase + "connection"
	pathRotate   = mgmtBase + "token/rotate"
	defaultResID = "/v0/resource/plugins/fangcun"
)

var resBase struct {
	sync.RWMutex
	path string
}

func setResourceBase(p string) {
	resBase.Lock()
	resBase.path = strings.TrimRight(p, "/")
	resBase.Unlock()
}

// ResourceBase is where CLIProxyAPI serves this plugin's resources.
func ResourceBase() string {
	resBase.RLock()
	defer resBase.RUnlock()
	if resBase.path == "" {
		return defaultResID
	}
	return resBase.path
}

func managementRoutes() any {
	return map[string]any{
		"routes": []map[string]string{
			{"method": "GET", "path": pathConn, "description": "Fangcun: feed token and path for the connection string"},
			{"method": "POST", "path": pathRotate, "description": "Fangcun: replace the feed token"},
		},
		"resources": []map[string]string{
			{"Path": pathPanel, "Menu": "方寸", "Description": "方寸连接串"},
			{"Path": pathFeed, "Description": "Fangcun read-only quota feed (feed token required)"},
		},
	}
}

func reply(status int, v any) map[string]any {
	b, _ := json.Marshal(v)
	return map[string]any{"StatusCode": status, "Headers": map[string][]string{
		"Content-Type":           {"application/json; charset=utf-8"},
		"Cache-Control":          {"no-store"},
		"X-Content-Type-Options": {"nosniff"},
	}, "Body": b}
}

// Route answers a management or resource request.
func Route(r pluginapi.ManagementRequest) map[string]any {
	path := strings.TrimRight(r.Path, "/")
	method := strings.ToUpper(r.Method)
	switch {
	case strings.HasPrefix(path, "/v0/resource/") && strings.HasSuffix(path, pathPanel):
		return map[string]any{"StatusCode": 200, "Headers": map[string][]string{
			"Content-Type":           {"text/html; charset=utf-8"},
			"Cache-Control":          {"no-cache"},
			"X-Content-Type-Options": {"nosniff"},
			"Referrer-Policy":        {"no-referrer"},
		}, "Body": pageHTML}
	case strings.HasPrefix(path, "/v0/resource/") && strings.HasSuffix(path, pathFeed):
		return serveFeed(r)
	case strings.HasPrefix(path, "/v0/management/") && strings.HasSuffix(path, "/"+pathConn) && method == "GET":
		t, err := CurrentToken()
		if err != nil {
			return reply(500, map[string]string{"error": err.Error()})
		}
		return reply(200, map[string]any{"token": t.Token, "createdAt": t.CreatedAt, "feedPath": ResourceBase() + pathFeed, "version": Version})
	case strings.HasPrefix(path, "/v0/management/") && strings.HasSuffix(path, "/"+pathRotate) && method == "POST":
		t, err := RotateToken()
		if err != nil {
			return reply(500, map[string]string{"error": err.Error()})
		}
		return reply(200, map[string]any{"token": t.Token, "createdAt": t.CreatedAt, "feedPath": ResourceBase() + pathFeed, "version": Version})
	}
	return reply(404, map[string]string{"error": "not found"})
}

func presentedToken(h http.Header) string {
	if v := strings.TrimSpace(h.Get("Authorization")); v != "" {
		if len(v) > 7 && strings.EqualFold(v[:7], "bearer ") {
			return strings.TrimSpace(v[7:])
		}
	}
	return strings.TrimSpace(h.Get("X-Fangcun-Token"))
}

func serveFeed(r pluginapi.ManagementRequest) map[string]any {
	// The token is only accepted in a header, never in the query string (which ends up in access logs).
	if !CheckToken(presentedToken(http.Header(r.Headers))) {
		resp := reply(401, map[string]string{"error": "feed token required"})
		resp["Headers"].(map[string][]string)["WWW-Authenticate"] = []string{`Bearer realm="fangcun"`}
		return resp
	}
	force := r.Query.Get("refresh") == "1"
	snap, err := Get(force)
	if err != nil {
		return reply(502, map[string]string{"error": clip(err.Error(), 200)})
	}
	return reply(200, snap)
}
