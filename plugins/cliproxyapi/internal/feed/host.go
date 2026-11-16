// Package feed is the CLIProxyAPI side of 方寸's read-only quota feed: the RPC
// methods CLIProxyAPI calls (plugin.register, management.*) and the host
// callbacks it makes (host.auth.list / host.auth.get / host.http.do). The cgo
// exports live in package main (cmd/plugin), which hands this package a way to
// call the host.
package feed

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginabi"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginapi"
)

// Caller calls the host: method, a JSON-encodable payload, the result.
type Caller func(method string, payload any) (json.RawMessage, error)

var (
	callerMu sync.RWMutex
	caller   Caller
)

// SetCaller sets how this package reaches the host.
func SetCaller(c Caller) {
	callerMu.Lock()
	caller = c
	callerMu.Unlock()
}

func callHost(method string, payload any) (json.RawMessage, error) {
	callerMu.RLock()
	c := caller
	callerMu.RUnlock()
	if c == nil {
		return nil, fmt.Errorf("host is not available")
	}
	return c(method, payload)
}

// Host is what the feed needs from CLIProxyAPI. Tests replace it.
type Host interface {
	AuthList() ([]pluginapi.HostAuthFileEntry, error)
	// AuthJSON is the credential file's raw JSON. It never leaves the plugin.
	AuthJSON(authIndex string) ([]byte, error)
	HTTP(method, url string, headers http.Header, body []byte) (int, http.Header, []byte, error)
}

type rpcHost struct{}

func (rpcHost) AuthList() ([]pluginapi.HostAuthFileEntry, error) {
	raw, err := callHost(pluginabi.MethodHostAuthList, map[string]any{})
	if err != nil {
		return nil, err
	}
	var out struct {
		Files []pluginapi.HostAuthFileEntry `json:"files"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out.Files, nil
}

func (rpcHost) AuthJSON(authIndex string) ([]byte, error) {
	raw, err := callHost(pluginabi.MethodHostAuthGet, map[string]string{"auth_index": authIndex})
	if err != nil {
		return nil, err
	}
	var out struct {
		JSON json.RawMessage `json:"json"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out.JSON, nil
}

type hostHTTPRequest struct {
	Method  string      `json:"method"`
	URL     string      `json:"url"`
	Headers http.Header `json:"headers,omitempty"`
	Body    []byte      `json:"body,omitempty"`
}

// HTTP goes out through CLIProxyAPI's own client (its proxy settings).
func (rpcHost) HTTP(method, url string, headers http.Header, body []byte) (int, http.Header, []byte, error) {
	raw, err := callHost(pluginabi.MethodHostHTTPDo, hostHTTPRequest{Method: method, URL: url, Headers: headers, Body: body})
	if err != nil {
		return 0, nil, nil, err
	}
	var res pluginapi.HTTPResponse
	if err := json.Unmarshal(raw, &res); err != nil {
		return 0, nil, nil, err
	}
	return res.StatusCode, res.Headers, res.Body, nil
}

var (
	hostMu  sync.RWMutex
	theHost Host = rpcHost{}
)

func host() Host {
	hostMu.RLock()
	defer hostMu.RUnlock()
	return theHost
}

// SetHost replaces the host (tests).
func SetHost(h Host) {
	hostMu.Lock()
	theHost = h
	hostMu.Unlock()
}
