package main

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"testing"
	"time"
)

// TestCSRFConfiguration verifies that CSRF protection can be configured
// with all required origins without errors. This test catches configuration
// bugs that would cause the server to fail at startup.
func TestCSRFConfiguration(t *testing.T) {
	// This test replicates the exact CSRF configuration from main()
	// to ensure it doesn't fail during server startup
	csrf := http.NewCrossOriginProtection()

	// Test base domain
	if err := csrf.AddTrustedOrigin("https://" + baseDomain); err != nil {
		t.Fatalf("Failed to configure CSRF for base domain: %v", err)
	}

	// Test subdomain wildcard
	if err := csrf.AddTrustedOrigin("https://*." + baseDomain); err != nil {
		t.Fatalf("Failed to configure CSRF for subdomains: %v", err)
	}

	// Test localhost (covers all ports)
	if err := csrf.AddTrustedOrigin("http://localhost"); err != nil {
		t.Fatalf("Failed to configure CSRF for localhost: %v", err)
	}
}

// TestCSRFOriginValidation tests various origin configurations to understand
// what the CSRF protection accepts.
func TestCSRFOriginValidation(t *testing.T) {
	tests := []struct {
		name    string
		origin  string
		wantErr bool
	}{
		{
			name:    "https base domain",
			origin:  "https://" + baseDomain,
			wantErr: false,
		},
		{
			name:    "https subdomain wildcard",
			origin:  "https://*." + baseDomain,
			wantErr: false,
		},
		{
			name:    "http localhost",
			origin:  "http://localhost",
			wantErr: false,
		},
		{
			name:    "http localhost with specific port",
			origin:  "http://localhost:8080",
			wantErr: false,
		},
		{
			name:    "http localhost with wildcard port",
			origin:  "http://localhost:*",
			wantErr: true, // Expected to fail - invalid port syntax
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			csrf := http.NewCrossOriginProtection()
			err := csrf.AddTrustedOrigin(tt.origin)
			if (err != nil) != tt.wantErr {
				t.Errorf("AddTrustedOrigin(%q) error = %v, wantErr %v", tt.origin, err, tt.wantErr)
			}
		})
	}
}

// TestServerIntegration builds and starts the server binary, verifies it serves
// HTTP requests successfully, then shuts it down. This is a full integration test
// that catches startup failures and configuration errors.
func TestServerIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Build the binary
	ctx := context.Background()
	buildCtx, buildCancel := context.WithTimeout(ctx, 30*time.Second)
	defer buildCancel()

	binaryPath := "./dashboard-test"
	t.Cleanup(func() {
		_ = os.Remove(binaryPath) //nolint:errcheck // best-effort cleanup of test binary
	})

	buildCmd := exec.CommandContext(buildCtx, "go", "build", "-o", binaryPath, ".")
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build binary: %v\nOutput: %s", err, output)
	}

	// Start the server on a specific test port
	serverCtx, serverCancel := context.WithCancel(ctx)
	defer serverCancel()

	serverCmd := exec.CommandContext(serverCtx, binaryPath)
	serverCmd.Env = append(os.Environ(),
		"PORT=18765", // Use a specific test port
		"GITHUB_CLIENT_ID=test_client_id",
		"GITHUB_CLIENT_SECRET=test_secret",
	)

	// Capture server output for debugging
	serverCmd.Stdout = os.Stdout
	serverCmd.Stderr = os.Stderr

	if err := serverCmd.Start(); err != nil {
		t.Fatalf("Failed to start server: %v", err)
	}

	// Ensure server is killed when test completes
	t.Cleanup(func() {
		serverCancel()
		if serverCmd.Process != nil {
			_ = serverCmd.Process.Kill() //nolint:errcheck // best-effort cleanup of test process
			_ = serverCmd.Wait()         //nolint:errcheck // best-effort cleanup of test process
		}
	})

	// Wait for server to be ready
	serverURL := "http://localhost:18765"
	client := &http.Client{Timeout: 5 * time.Second}

	var lastErr error
	for range 50 {
		time.Sleep(100 * time.Millisecond)

		resp, err := client.Get(serverURL + "/health")
		if err != nil {
			lastErr = err
			continue
		}
		_ = resp.Body.Close() //nolint:errcheck // best-effort close in health check loop

		if resp.StatusCode == http.StatusOK {
			t.Log("Server started successfully and responding to requests")
			return
		}

		lastErr = nil
	}

	if lastErr != nil {
		t.Fatalf("Server failed to respond after 5 seconds: %v", lastErr)
	}
	t.Fatal("Server did not return 200 OK within 5 seconds")
}

// TestBaseDomainRedirect verifies that the frontpage of the base domain
// redirects to codegroove.dev/reviewgoose/ while subdomains serve the dashboard.
func TestBaseDomainRedirect(t *testing.T) {
	tests := []struct {
		name         string
		host         string
		path         string
		wantRedirect bool
		wantLocation string
	}{
		{
			name:         "base domain frontpage redirects",
			host:         baseDomain,
			path:         "/",
			wantRedirect: true,
			wantLocation: "https://codegroove.dev/reviewgoose/",
		},
		{
			name:         "base domain with assets does not redirect",
			host:         baseDomain,
			path:         "/assets/styles.css",
			wantRedirect: false,
		},
		{
			name:         "my subdomain frontpage does not redirect",
			host:         "my." + baseDomain,
			path:         "/",
			wantRedirect: false,
		},
		{
			name:         "org subdomain frontpage does not redirect",
			host:         "kubernetes." + baseDomain,
			path:         "/",
			wantRedirect: false,
		},
		{
			name:         "case insensitive base domain redirects",
			host:         "ReviewGOOSE.dev",
			path:         "/",
			wantRedirect: true,
			wantLocation: "https://codegroove.dev/reviewgoose/",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, "http://"+tt.host+tt.path, http.NoBody)
			if err != nil {
				t.Fatalf("Failed to create request: %v", err)
			}

			// Test with CheckRedirect to prevent following redirects
			client := &http.Client{
				CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
					return http.ErrUseLastResponse
				},
			}

			// Use responseWriter to capture response
			rr := &testResponseWriter{header: make(http.Header)}
			serveStaticFiles(rr, req)

			if tt.wantRedirect {
				if rr.statusCode != http.StatusFound {
					t.Errorf("Expected redirect (302), got %d", rr.statusCode)
				}
				location := rr.Header().Get("Location")
				if location != tt.wantLocation {
					t.Errorf("Expected redirect to %q, got %q", tt.wantLocation, location)
				}
			} else if rr.statusCode == http.StatusFound {
				location := rr.Header().Get("Location")
				t.Errorf("Unexpected redirect to %q", location)
			}

			_ = client // Suppress unused variable warning
		})
	}
}

// testResponseWriter is a simple ResponseWriter for testing.
type testResponseWriter struct {
	header     http.Header
	statusCode int
	body       []byte
}

func (w *testResponseWriter) Header() http.Header {
	return w.header
}

func (w *testResponseWriter) Write(b []byte) (int, error) {
	w.body = append(w.body, b...)
	return len(b), nil
}

func (w *testResponseWriter) WriteHeader(statusCode int) {
	w.statusCode = statusCode
}
