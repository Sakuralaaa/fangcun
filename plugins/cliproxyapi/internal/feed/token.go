package feed

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// The feed token is the plugin's own read-only key: it opens the feed and
// nothing else (not the management API, not the proxy). It lives in a dot file
// next to CLIProxyAPI's credential files (no .json suffix, so the auth watcher
// leaves it alone), else in the user's config directory.
const tokenFileName = ".fangcun-feed"

// TokenPrefix marks a feed token.
const TokenPrefix = "fcq_"

type tokenFile struct {
	Token     string `json:"token"`
	CreatedAt string `json:"created_at"`
}

var tokenState struct {
	sync.Mutex
	loaded bool
	path   string
	file   tokenFile
}

// stateDirFn finds where the token file goes; tests replace it.
var stateDirFn = func() string {
	if entries, err := host().AuthList(); err == nil {
		for _, e := range entries {
			if e.Path != "" {
				return filepath.Dir(e.Path)
			}
		}
	}
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "cliproxyapi-fangcun")
	}
	return os.TempDir()
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return TokenPrefix + base64.RawURLEncoding.EncodeToString(b), nil
}

func loadTokenLocked() error {
	if tokenState.loaded && tokenState.file.Token != "" {
		return nil
	}
	if tokenState.path == "" {
		tokenState.path = filepath.Join(stateDirFn(), tokenFileName)
	}
	if raw, err := os.ReadFile(tokenState.path); err == nil {
		var f tokenFile
		if json.Unmarshal(raw, &f) == nil && strings.HasPrefix(f.Token, TokenPrefix) && len(f.Token) >= 40 {
			tokenState.file = f
			tokenState.loaded = true
			return nil
		}
	}
	return rotateLocked()
}

func rotateLocked() error {
	t, err := newToken()
	if err != nil {
		return err
	}
	f := tokenFile{Token: t, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	raw, _ := json.Marshal(f)
	if err := os.MkdirAll(filepath.Dir(tokenState.path), 0o700); err != nil {
		return fmt.Errorf("token dir: %w", err)
	}
	tmp := tokenState.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return fmt.Errorf("write token: %w", err)
	}
	if err := os.Rename(tmp, tokenState.path); err != nil {
		return fmt.Errorf("write token: %w", err)
	}
	tokenState.file = f
	tokenState.loaded = true
	return nil
}

// CurrentToken returns the feed token, creating it on first use.
func CurrentToken() (tokenFile, error) {
	tokenState.Lock()
	defer tokenState.Unlock()
	if err := loadTokenLocked(); err != nil {
		return tokenFile{}, err
	}
	return tokenState.file, nil
}

// RotateToken replaces the feed token; every connection string made before stops working.
func RotateToken() (tokenFile, error) {
	tokenState.Lock()
	defer tokenState.Unlock()
	if tokenState.path == "" {
		tokenState.path = filepath.Join(stateDirFn(), tokenFileName)
	}
	if err := rotateLocked(); err != nil {
		return tokenFile{}, err
	}
	return tokenState.file, nil
}

// CheckToken reports whether presented is the feed token (constant time).
func CheckToken(presented string) bool {
	presented = strings.TrimSpace(presented)
	if !strings.HasPrefix(presented, TokenPrefix) {
		return false
	}
	f, err := CurrentToken()
	if err != nil || f.Token == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(f.Token)) == 1
}

// resetTokenState forgets the cached token (tests).
func resetTokenState(path string) {
	tokenState.Lock()
	tokenState.loaded = false
	tokenState.path = path
	tokenState.file = tokenFile{}
	tokenState.Unlock()
}
