package main

/*
#include <stdint.h>
#include <stdlib.h>

typedef struct {
	void* ptr;
	size_t len;
} cliproxy_buffer;

typedef int (*cliproxy_host_call_fn)(void*, const char*, const uint8_t*, size_t, cliproxy_buffer*);
typedef void (*cliproxy_host_free_fn)(void*, size_t);

typedef struct {
	uint32_t abi_version;
	void* host_ctx;
	cliproxy_host_call_fn call;
	cliproxy_host_free_fn free_buffer;
} cliproxy_host_api;

typedef int (*cliproxy_plugin_call_fn)(char*, uint8_t*, size_t, cliproxy_buffer*);
typedef void (*cliproxy_plugin_free_fn)(void*, size_t);
typedef void (*cliproxy_plugin_shutdown_fn)(void);

typedef struct {
	uint32_t abi_version;
	cliproxy_plugin_call_fn call;
	cliproxy_plugin_free_fn free_buffer;
	cliproxy_plugin_shutdown_fn shutdown;
} cliproxy_plugin_api;

extern int cliproxyPluginCall(char*, uint8_t*, size_t, cliproxy_buffer*);
extern void cliproxyPluginFree(void*, size_t);
extern void cliproxyPluginShutdown(void);

static const cliproxy_host_api* stored_host;

static void store_host_api(const cliproxy_host_api* host) { stored_host = host; }

static int call_host_api(const char* method, const uint8_t* request, size_t request_len, cliproxy_buffer* response) {
	if (stored_host == NULL || stored_host->call == NULL) return 1;
	return stored_host->call(stored_host->host_ctx, method, request, request_len, response);
}

static void free_host_buffer(void* ptr, size_t len) {
	if (stored_host != NULL && stored_host->free_buffer != NULL && ptr != NULL) stored_host->free_buffer(ptr, len);
}
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"unsafe"

	"github.com/Sakuralaaa/fangcun/plugins/cliproxyapi/internal/feed"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginabi"
)

func main() {}

type hostEnvelope struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func hostCall(method string, payload any) (json.RawMessage, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	cMethod := C.CString(method)
	defer C.free(unsafe.Pointer(cMethod))
	var req *C.uint8_t
	if len(body) > 0 {
		req = (*C.uint8_t)(C.CBytes(body))
		defer C.free(unsafe.Pointer(req))
	}
	var resp C.cliproxy_buffer
	rc := C.call_host_api(cMethod, req, C.size_t(len(body)), &resp)
	var raw []byte
	if resp.ptr != nil {
		raw = C.GoBytes(resp.ptr, C.int(resp.len))
		C.free_host_buffer(resp.ptr, resp.len)
	}
	if len(raw) == 0 {
		if rc != 0 {
			return nil, fmt.Errorf("host call %s failed (%d)", method, int(rc))
		}
		return nil, nil
	}
	var env hostEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, err
	}
	if !env.OK {
		if env.Error != nil {
			return nil, fmt.Errorf("%s: %s", env.Error.Code, env.Error.Message)
		}
		return nil, fmt.Errorf("host call %s failed", method)
	}
	return env.Result, nil
}

//export cliproxy_plugin_init
func cliproxy_plugin_init(host *C.cliproxy_host_api, p *C.cliproxy_plugin_api) C.int {
	if p == nil {
		return 1
	}
	C.store_host_api(host)
	feed.SetCaller(hostCall)
	p.abi_version = C.uint32_t(pluginabi.ABIVersion)
	p.call = C.cliproxy_plugin_call_fn(C.cliproxyPluginCall)
	p.free_buffer = C.cliproxy_plugin_free_fn(C.cliproxyPluginFree)
	p.shutdown = C.cliproxy_plugin_shutdown_fn(C.cliproxyPluginShutdown)
	return 0
}

//export cliproxyPluginCall
func cliproxyPluginCall(method *C.char, request *C.uint8_t, requestLen C.size_t, response *C.cliproxy_buffer) C.int {
	if response != nil {
		response.ptr = nil
		response.len = 0
	}
	if method == nil {
		return 1
	}
	var req []byte
	if request != nil && requestLen > 0 {
		req = C.GoBytes(unsafe.Pointer(request), C.int(requestLen))
	}
	out, err := feed.Handle(C.GoString(method), req)
	if err != nil {
		out = []byte(fmt.Sprintf(`{"ok":false,"error":{"code":"plugin_error","message":%q}}`, err.Error()))
	}
	if response != nil && len(out) > 0 {
		response.ptr = C.CBytes(out)
		response.len = C.size_t(len(out))
	}
	if err != nil {
		return 1
	}
	return 0
}

//export cliproxyPluginFree
func cliproxyPluginFree(ptr unsafe.Pointer, _ C.size_t) {
	if ptr != nil {
		C.free(ptr)
	}
}

//export cliproxyPluginShutdown
func cliproxyPluginShutdown() { _, _ = feed.Handle(pluginabi.MethodPluginShutdown, nil) }
