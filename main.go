// Package main implements a secure OAuth2 server for the GitHub PR dashboard.
// It serves static files and handles GitHub OAuth authentication flow.
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/codeGROOVE-dev/gsm"
	"github.com/codeGROOVE-dev/retry"
)

// Constants for configuration.
const (
	defaultPort        = "8080"
	defaultAppID       = 1546081
	defaultClientID    = "Iv23liYmAKkBpvhHAnQQ"
	defaultRedirectURI = "https://reviewGOOSE.dev/oauth/callback"
	baseDomain         = "reviewGOOSE.dev"

	// Rate limiting.
	rateLimitRequests = 10
	rateLimitWindow   = 1 * time.Minute

	// Timeouts.
	httpTimeout     = 10 * time.Second
	shutdownTimeout = 30 * time.Second
	stateExpiry     = 5 * time.Minute

	// Security.
	maxRequestSize    = 1 << 20 // 1MB
	maxHeaderSize     = 1 << 20 // 1MB
	maxFailedLogins   = 5
	failedLoginWindow = 15 * time.Minute
)

//go:embed index.html
//go:embed assets/*
var staticFiles embed.FS

var (
	port           = flag.String("port", "", "Port to listen on (overrides $PORT)")
	appID          = flag.Int("app-id", defaultAppID, "GitHub App ID")
	clientID       = flag.String("client-id", defaultClientID, "GitHub OAuth Client ID")
	clientSecret   = flag.String("client-secret", "", "GitHub OAuth Client Secret")
	redirectURI    = flag.String("redirect-uri", defaultRedirectURI, "OAuth redirect URI")
	allowedOrigins = flag.String("allowed-origins", "", "Comma-separated list of allowed origins for CORS")

	// Build timestamp for cache busting (set at startup).
	buildTimestamp string

	// Security: Track failed login attempts.
	failedAttempts = make(map[string][]time.Time)
	failedMutex    sync.Mutex

	// One-time auth code exchange (token -> code mapping).
	// Used to securely transfer tokens from auth subdomain to user subdomain.
	authCodes      = make(map[string]authCodeData)
	authCodesMutex sync.Mutex

	// Rate limiter for auth code exchange endpoint (prevent brute force attacks).
	exchangeRateLimiter *rateLimiter

	// CSRF protection using Go 1.25's CrossOriginProtection (Fetch Metadata).
	csrfProtection *http.CrossOriginProtection
)

// authCodeData stores a one-time use auth code with expiration.
type authCodeData struct {
	expiry   time.Time
	token    string
	username string
	returnTo string
	used     bool
}

// rateLimiter implements a simple in-memory rate limiter.
type rateLimiter struct {
	requests map[string][]time.Time
	window   time.Duration
	limit    int
	mu       sync.Mutex
}

func (rl *rateLimiter) limitHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)

		rl.mu.Lock()
		defer rl.mu.Unlock()

		now := time.Now()
		cutoff := now.Add(-rl.window)

		// Clean old requests - reuse slice to reduce allocations
		validRequests := rl.requests[ip][:0]
		for _, t := range rl.requests[ip] {
			if t.After(cutoff) {
				validRequests = append(validRequests, t)
			}
		}

		if len(validRequests) >= rl.limit {
			log.Printf("[SECURITY] Rate limit exceeded: ip=%s requests=%d limit=%d window=%v", ip, len(validRequests), rl.limit, rl.window)
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		rl.requests[ip] = append(validRequests, now)

		// Prevent memory exhaustion: periodically clean up IPs with no recent requests
		// This protects against DoS attacks using many different IPs
		if len(rl.requests)%100 == 0 {
			for oldIP, times := range rl.requests {
				if len(times) == 0 || (len(times) > 0 && times[len(times)-1].Before(cutoff)) {
					delete(rl.requests, oldIP)
				}
			}
		}

		next(w, r)
	}
}

// isValidGitHubHandle validates that a string looks like a valid GitHub handle.
// GitHub handles can only contain alphanumeric characters and single hyphens,
// cannot begin or end with a hyphen, and must be 1-39 characters long.
func isValidGitHubHandle(handle string) bool {
	if handle == "" || len(handle) > 39 {
		return false
	}

	// Cannot start or end with hyphen
	if strings.HasPrefix(handle, "-") || strings.HasSuffix(handle, "-") {
		return false
	}

	// Check each character
	for i, ch := range handle {
		if ch >= 'a' && ch <= 'z' {
			continue
		}
		if ch >= 'A' && ch <= 'Z' {
			continue
		}
		if ch >= '0' && ch <= '9' {
			continue
		}
		if ch == '-' {
			// No consecutive hyphens
			if i > 0 && handle[i-1] == '-' {
				return false
			}
			continue
		}
		return false
	}

	return true
}

// clientIP extracts the client IP address from the request.
func clientIP(r *http.Request) string {
	// SECURITY: Only use RemoteAddr to prevent header spoofing attacks
	// X-Forwarded-For and X-Real-IP are trivially spoofable and should not be trusted
	// for security-critical functions like rate limiting
	//
	// When behind a trusted proxy (like Cloud Run), RemoteAddr will be the proxy IP
	// This means rate limiting happens at the proxy level, which is acceptable
	// as it still prevents single-source DoS attacks
	ip := r.RemoteAddr
	if colon := strings.LastIndex(ip, ":"); colon != -1 {
		return ip[:colon]
	}
	return ip
}

// securityHeaders adds security headers to all responses.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Add request ID for tracking
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = generateID(8)
		}
		w.Header().Set("X-Request-ID", requestID)
		// Prevent clickjacking
		w.Header().Set("X-Frame-Options", "DENY")

		// Prevent MIME type sniffing
		w.Header().Set("X-Content-Type-Options", "nosniff")

		// Enable XSS protection
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		// Referrer policy
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// Permissions policy
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

		// Content Security Policy
		csp := []string{
			"default-src 'self' https://reviewGOOSE.dev https://*.reviewGOOSE.dev",
			"script-src 'self' https://reviewGOOSE.dev https://*.reviewGOOSE.dev",
			"style-src 'self' https://reviewGOOSE.dev https://*.reviewGOOSE.dev",
			"img-src 'self' https://reviewGOOSE.dev https://*.reviewGOOSE.dev https://avatars.githubusercontent.com data:",
			"connect-src 'self' https://api.github.com https://turn.github.codegroove.app",
			"font-src 'self' https://reviewGOOSE.dev https://*.reviewGOOSE.dev",
			"object-src 'none'",
			"frame-src 'none'",
			"base-uri 'self'",
			"form-action 'self'",
			"frame-ancestors 'none'",
			"upgrade-insecure-requests",
		}
		w.Header().Set("Content-Security-Policy", strings.Join(csp, "; "))

		// HSTS with preload (only for HTTPS)
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			// 2 years (recommended for preload), includeSubDomains, and preload directive
			w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
		}

		next.ServeHTTP(w, r)
	})
}

// oauthTokenResponse represents the GitHub OAuth token response.
type oauthTokenResponse struct {
	AccessToken      string `json:"access_token"`
	TokenType        string `json:"token_type"`
	Scope            string `json:"scope"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// githubUser represents a GitHub user.
type githubUser struct {
	Login string `json:"login"`
	Name  string `json:"name"`
	ID    int    `json:"id"`
}

// loadClientSecret retrieves the GitHub OAuth client secret from environment or Secret Manager.
func loadClientSecret(ctx context.Context) string {
	// Check environment variable first
	if value := os.Getenv("GITHUB_CLIENT_SECRET"); value != "" {
		log.Print("Using GITHUB_CLIENT_SECRET from environment variable")
		return value
	}

	// Check if running in Cloud Run
	isCloudRun := os.Getenv("K_SERVICE") != "" || os.Getenv("CLOUD_RUN_TIMEOUT_SECONDS") != ""
	if !isCloudRun {
		log.Print("Not running in Cloud Run, skipping Secret Manager")
		return ""
	}

	// Fetch from Secret Manager (auto-detects project ID from metadata server)
	log.Print("Fetching GITHUB_CLIENT_SECRET from Google Secret Manager")
	secretValue, err := gsm.Fetch(ctx, "GITHUB_CLIENT_SECRET")
	if err != nil {
		log.Printf("Failed to fetch secret from Secret Manager: %v", err)
		return ""
	}

	if secretValue == "" {
		log.Print("WARNING: Secret Manager returned empty value for GITHUB_CLIENT_SECRET")
	} else {
		log.Print("Successfully fetched GITHUB_CLIENT_SECRET from Google Secret Manager")
	}

	return secretValue
}

func main() {
	flag.Parse()

	// Set build timestamp for cache busting
	buildTimestamp = strconv.FormatInt(time.Now().Unix(), 10)

	// Determine port with flag taking precedence over environment
	serverPort := *port
	if serverPort == "" {
		serverPort = os.Getenv("PORT")
	}
	if serverPort == "" {
		serverPort = defaultPort
	}

	// Allow environment variables to override empty flag values
	if *appID == defaultAppID {
		if envAppID := os.Getenv("GITHUB_APP_ID"); envAppID != "" {
			if id, err := strconv.Atoi(envAppID); err == nil {
				*appID = id
			}
		}
	}

	if *clientID == defaultClientID || *clientID == "" {
		if envClientID := os.Getenv("GITHUB_CLIENT_ID"); envClientID != "" {
			*clientID = envClientID
		}
	}

	// Load client secret from environment or Secret Manager
	if *clientSecret == "" {
		ctx := context.Background()
		*clientSecret = loadClientSecret(ctx)
	}

	if *redirectURI == defaultRedirectURI || *redirectURI == "" {
		if envRedirectURI := os.Getenv("OAUTH_REDIRECT_URI"); envRedirectURI != "" {
			*redirectURI = envRedirectURI
		}
	}

	if *allowedOrigins == "" {
		if envAllowedOrigins := os.Getenv("ALLOWED_ORIGINS"); envAllowedOrigins != "" {
			*allowedOrigins = envAllowedOrigins
		}
	}

	// Initialize rate limiter for auth code exchange (strict: 10 attempts per minute per IP)
	exchangeRateLimiter = &rateLimiter{
		requests: make(map[string][]time.Time),
		limit:    rateLimitRequests,
		window:   rateLimitWindow,
	}

	// Initialize CSRF protection using Go 1.25's CrossOriginProtection
	// Uses Fetch Metadata (Sec-Fetch-Site header) for reliable cross-origin detection
	csrfProtection = http.NewCrossOriginProtection()
	// Trust requests from our own domain and all subdomains
	if err := csrfProtection.AddTrustedOrigin("https://" + baseDomain); err != nil {
		log.Fatalf("CRITICAL: Failed to configure CSRF protection for base domain: %v", err)
	}
	if err := csrfProtection.AddTrustedOrigin("https://*." + baseDomain); err != nil {
		log.Fatalf("CRITICAL: Failed to configure CSRF protection for subdomains: %v", err)
	}
	// Allow localhost for development (covers all ports)
	if err := csrfProtection.AddTrustedOrigin("http://localhost"); err != nil {
		log.Fatalf("CRITICAL: Failed to configure CSRF protection for localhost: %v", err)
	}

	// Set up routes
	mux := http.NewServeMux()

	// OAuth endpoints
	// Register API endpoints before catch-all to ensure they match first
	// Auth code exchange has rate limiting + CSRF protection (Go 1.25 CrossOriginProtection)
	mux.Handle("/oauth/exchange", csrfProtection.Handler(exchangeRateLimiter.limitHandler(handleExchangeAuthCode)))
	mux.HandleFunc("/oauth/login", handleOAuthLogin)
	mux.HandleFunc("/oauth/callback", handleOAuthCallback)
	mux.HandleFunc("/oauth/user", handleGetUser)

	// Health check endpoint
	mux.HandleFunc("/health", handleHealthCheck)

	// Serve everything else as SPA (including assets)
	// This MUST be registered last as it's a catch-all
	mux.HandleFunc("/", serveStaticFiles)

	// Wrap with security middleware
	handler := requestLogger(requestSizeLimiter(securityHeaders(mux)))

	// Start server with graceful shutdown
	addr := ":" + serverPort
	srv := &http.Server{
		Addr:           addr,
		Handler:        handler,
		ReadTimeout:    httpTimeout,
		WriteTimeout:   httpTimeout,
		IdleTimeout:    httpTimeout * 12, // 2 minutes
		MaxHeaderBytes: maxHeaderSize,
	}

	log.Printf("Starting server on %s", addr)
	log.Printf("GitHub App ID: %d", *appID)
	log.Printf("OAuth Client ID: %s", *clientID)
	log.Printf("OAuth Redirect URI: %s", *redirectURI)
	if *clientSecret == "" {
		log.Print("WARNING: OAuth Client Secret not set. OAuth login will not work.")
		log.Print("Set GITHUB_CLIENT_SECRET environment variable or use --client-secret flag")
	} else {
		log.Print("OAuth Client Secret: configured")
	}

	// Start auth code cleanup goroutine
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()

		for range ticker.C {
			authCodesMutex.Lock()
			now := time.Now()
			for code, data := range authCodes {
				if now.After(data.expiry) {
					delete(authCodes, code)
				}
			}
			authCodesMutex.Unlock()
		}
	}()

	// Start server in goroutine
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

func serveStaticFiles(w http.ResponseWriter, r *http.Request) {
	// Only allow GET, HEAD, and OPTIONS methods
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
		log.Printf("[serveStaticFiles] Rejecting %s request to %s (405)", r.Method, r.URL.Path)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Redirect base domain frontpage to codegroove.dev
	currentHost := r.Header.Get("X-Original-Host")
	if currentHost == "" {
		currentHost = r.Host
	}

	// Check if this is the base domain (not a subdomain) and the frontpage
	if strings.EqualFold(currentHost, baseDomain) && (r.URL.Path == "/" || r.URL.Path == "") {
		http.Redirect(w, r, "https://codegroove.dev/reviewgoose/", http.StatusFound)
		return
	}

	// CORS: Allow subdomains to load assets from naked domain
	// Check Origin header and allow all subdomains of reviewGOOSE.dev
	origin := r.Header.Get("Origin")
	if origin != "" {
		// Parse origin to validate it's one of our subdomains
		if u, err := url.Parse(origin); err == nil {
			host := strings.ToLower(u.Hostname())
			baseDomainLower := strings.ToLower(baseDomain)
			// Allow naked domain and all subdomains (case-insensitive)
			if host == baseDomainLower || strings.HasSuffix(host, "."+baseDomainLower) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
				w.Header().Set("Vary", "Origin")
			}
		}
	}

	// Handle preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Clean the path
	path := filepath.Clean(r.URL.Path)

	// Prevent directory traversal
	if strings.Contains(path, "..") || strings.Contains(path, "~") {
		http.NotFound(w, r)
		return
	}

	// Remove leading slash for embed.FS
	if path == "/" || path == "." {
		path = "index.html"
	} else {
		path = strings.TrimPrefix(path, "/")
	}

	// Try to read the file from embedded FS
	data, err := staticFiles.ReadFile(path)
	if err != nil {
		// If file not found and not an asset, serve index.html for SPA routing
		if !strings.HasPrefix(path, "assets/") && !strings.HasSuffix(path, ".ico") {
			data, err = staticFiles.ReadFile("index.html")
			if err != nil {
				log.Printf("Failed to serve fallback index.html: %v", err)
				http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			if _, err := w.Write(data); err != nil {
				log.Printf("Failed to write response: %v", err)
			}
			return
		}
		http.NotFound(w, r)
		return
	}

	// Set content type and cache headers based on file extension
	switch {
	case strings.HasSuffix(path, ".html"):
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		// Never cache HTML files - they contain BUILD_TIMESTAMP references to versioned assets
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		// Replace BUILD_TIMESTAMP placeholder with actual timestamp for cache busting
		data = []byte(strings.ReplaceAll(string(data), "BUILD_TIMESTAMP", buildTimestamp))
	case strings.HasSuffix(path, ".css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		// Cache CSS for 1 year since URL includes version query param
		if r.URL.Query().Get("v") != "" {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
	case strings.HasSuffix(path, ".js"):
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		// Cache JS for 1 year since URL includes version query param
		if r.URL.Query().Get("v") != "" {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
	case strings.HasSuffix(path, ".json"):
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	case strings.HasSuffix(path, ".png"):
		w.Header().Set("Content-Type", "image/png")
	case strings.HasSuffix(path, ".jpg"), strings.HasSuffix(path, ".jpeg"):
		w.Header().Set("Content-Type", "image/jpeg")
	case strings.HasSuffix(path, ".svg"):
		w.Header().Set("Content-Type", "image/svg+xml")
	case strings.HasSuffix(path, ".ico"):
		w.Header().Set("Content-Type", "image/x-icon")
	default:
		// No specific content type
	}

	// Write the file content
	if _, err := w.Write(data); err != nil {
		log.Printf("Failed to write file content: %v", err)
	}
}

// validateReturnToURL validates that a return_to URL is safe to redirect to.
// Returns the validated URL or empty string if invalid.
func validateReturnToURL(returnTo string) string {
	if returnTo == "" {
		return ""
	}

	parsedURL, err := url.Parse(returnTo)
	if err != nil {
		return ""
	}

	host := parsedURL.Hostname()
	urlScheme := parsedURL.Scheme

	// Only allow http/https schemes
	switch urlScheme {
	case "http", "https":
		// Valid scheme, continue validation
	default:
		log.Printf("[SECURITY] Invalid return_to scheme: %s", urlScheme)
		return ""
	}

	// Validate domain is ours
	if host != baseDomain && !strings.HasSuffix(host, "."+baseDomain) {
		log.Printf("[SECURITY] Invalid return_to domain: %s", host)
		return ""
	}

	// Validate subdomain format if not base domain
	if host != baseDomain {
		parts := strings.Split(host, ".")
		if len(parts) >= 3 {
			subdomain := parts[0]
			// Reserved subdomains that don't need GitHub handle validation
			reservedSubdomains := []string{"www", "dash", "api", "login", "auth-callback", "my"}
			isReserved := false
			for _, reserved := range reservedSubdomains {
				if strings.EqualFold(subdomain, reserved) {
					isReserved = true
					break
				}
			}
			// Validate subdomain is a valid GitHub handle (prevents punycode, homograph attacks, etc.)
			// unless it's a reserved subdomain
			if !isReserved && !isValidGitHubHandle(subdomain) {
				log.Printf("[SECURITY] Invalid GitHub handle in return_to subdomain: %s", subdomain)
				return ""
			}
		}
	}

	return returnTo
}

func handleOAuthLogin(w http.ResponseWriter, r *http.Request) {
	if *clientID == "" {
		log.Print("OAuth login attempted but client ID not configured. Set GITHUB_CLIENT_ID environment variable or use --client-id flag")
		http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
		return
	}

	// Get current host to determine return destination
	currentHost := r.Header.Get("X-Original-Host")
	if currentHost == "" {
		currentHost = r.Host
	}

	isSecure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	scheme := "http"
	if isSecure {
		scheme = "https"
	}

	// If not on base domain, redirect there with return_to parameter
	// Use case-insensitive comparison since DNS hostnames are case-insensitive
	if !strings.EqualFold(currentHost, baseDomain) {
		returnTo := fmt.Sprintf("%s://%s/", scheme, currentHost)
		authURL := fmt.Sprintf("%s://%s/oauth/login?return_to=%s", scheme, baseDomain, url.QueryEscape(returnTo))
		log.Printf("[OAuth] Redirecting to base domain for OAuth: %s", authURL)
		http.Redirect(w, r, authURL, http.StatusFound)
		return
	}

	// We're on base domain - proceed with OAuth flow
	// Store return_to in state
	returnTo := r.URL.Query().Get("return_to")

	// Generate state for CSRF protection (include return_to)
	stateData := generateID(16)
	if returnTo != "" {
		// Store return_to in cookie so callback can use it
		returnCookie := &http.Cookie{
			Name:     "oauth_return_to",
			Value:    returnTo,
			Path:     "/",
			HttpOnly: true,
			Secure:   isSecure,
			SameSite: http.SameSiteLaxMode, // Lax required for OAuth redirect from GitHub
			MaxAge:   900,                  // 15 minutes
		}
		http.SetCookie(w, returnCookie)
	}

	// Store state in cookie
	stateCookie := &http.Cookie{
		Name:     "oauth_state",
		Value:    stateData,
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteLaxMode, // Lax required for OAuth redirect from GitHub
		Expires:  time.Now().Add(stateExpiry),
	}
	http.SetCookie(w, stateCookie)

	// Build authorization URL (always use reviewGOOSE.dev callback)
	authURL := fmt.Sprintf(
		"https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&scope=%s&state=%s",
		url.QueryEscape(*clientID),
		url.QueryEscape(*redirectURI),
		url.QueryEscape("repo read:org"),
		url.QueryEscape(stateData),
	)

	log.Printf("[OAuth] Starting OAuth with return_to=%s", returnTo)
	http.Redirect(w, r, authURL, http.StatusFound)
}

func handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if *clientID == "" || *clientSecret == "" {
		log.Printf("OAuth callback attempted but not configured: client_id=%q client_secret_set=%v",
			*clientID, *clientSecret != "")
		log.Print("Set GITHUB_CLIENT_SECRET environment variable or --client-secret flag")
		http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
		return
	}

	// Check for OAuth errors from GitHub
	if errCode := r.URL.Query().Get("error"); errCode != "" {
		errDesc := r.URL.Query().Get("error_description")
		log.Printf("OAuth error: %s - %s", errCode, errDesc)

		// Return user-friendly error page
		escapedMsg := strings.NewReplacer(
			"&", "&amp;",
			"<", "&lt;",
			">", "&gt;",
			"\"", "&quot;",
			"'", "&#39;",
		).Replace("Authentication was cancelled or failed. Please try again.")
		html := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <title>Authentication Failed</title>
</head>
<body>
    <h1>Authentication Failed</h1>
    <p>%s</p>
    <p>You can close this window and try again.</p>
</body>
</html>
`, escapedMsg)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if _, err := w.Write([]byte(html)); err != nil {
			log.Printf("Failed to write error response: %v", err)
		}
		return
	}

	// Check if this is a GitHub App installation callback
	installationID := r.URL.Query().Get("installation_id")
	setupAction := r.URL.Query().Get("setup_action")

	if installationID != "" && setupAction != "" {
		// This is a GitHub App installation callback
		log.Printf("GitHub App installation callback: installation_id=%s, setup_action=%s", installationID, setupAction)

		// Return a success page for app installations
		escapedAction := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;").Replace(setupAction)
		escapedID := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;").Replace(installationID)

		html := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <title>GitHub App Installation</title>
</head>
<body>
    <h1>GitHub App Installed Successfully</h1>
    <p>The GitHub App has been %s successfully.</p>
    <p>Installation ID: %s</p>
    <p>This window will close automatically in 3 seconds.</p>
    <script>
        // Auto-close after 3 seconds
        setTimeout(function() {
            window.close();
        }, 3000);
    </script>
</body>
</html>
`, escapedAction, escapedID)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if _, err := w.Write([]byte(html)); err != nil {
			log.Printf("Failed to write GitHub App installation response: %v", err)
		}
		return
	}

	// Regular OAuth flow - verify state
	state := r.URL.Query().Get("state")
	if state == "" {
		trackFailedAttempt(clientIP(r))
		log.Printf("[OAuth] Missing state parameter from %s", clientIP(r))
		clearStateCookie(w)
		http.Error(w, "Missing state parameter", http.StatusBadRequest)
		return
	}

	cookie, err := r.Cookie("oauth_state")
	if err != nil {
		trackFailedAttempt(clientIP(r))
		log.Printf("[OAuth] Missing oauth_state cookie from %s: %v", clientIP(r), err)
		log.Printf("[OAuth] Available cookies: %d present", len(r.Cookies()))
		clearStateCookie(w)
		http.Error(w, "Invalid state", http.StatusBadRequest)
		return
	}

	// Use constant-time comparison to prevent timing attacks
	if subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
		trackFailedAttempt(clientIP(r))
		log.Printf("[OAuth] State mismatch from %s", clientIP(r))
		clearStateCookie(w)
		http.Error(w, "Invalid state", http.StatusBadRequest)
		return
	}

	log.Printf("[OAuth] State validation successful for %s", clientIP(r))

	// Get authorization code
	code := r.URL.Query().Get("code")
	if code == "" || len(code) > 512 {
		trackFailedAttempt(clientIP(r))
		clearStateCookie(w)
		http.Error(w, "Invalid authorization code", http.StatusBadRequest)
		return
	}

	// Exchange code for token (use registered callback URI)
	ctx := r.Context()
	token, err := exchangeCodeForToken(ctx, code, *redirectURI)
	if err != nil {
		trackFailedAttempt(clientIP(r))
		log.Printf("Failed to exchange code for token: %v", err)
		http.Error(w, "Authentication failed", http.StatusInternalServerError)
		return
	}

	// Fetch username to determine personal workspace
	user, err := userInfo(ctx, token)
	if err != nil {
		log.Printf("Failed to get user info after OAuth: %v", err)
		http.Error(w, "Failed to get user info", http.StatusInternalServerError)
		return
	}

	// Validate username format
	if !isValidGitHubHandle(user.Login) {
		log.Printf("[SECURITY] Invalid username format from GitHub OAuth: %s", user.Login)
		http.Error(w, "Invalid username format", http.StatusBadRequest)
		return
	}

	// Clear the state cookie after all validations pass
	clearStateCookie(w)

	// Get return_to from cookie
	returnTo := ""
	if returnCookie, err := r.Cookie("oauth_return_to"); err == nil && returnCookie.Value != "" {
		returnTo = returnCookie.Value
		// Clear the return_to cookie
		http.SetCookie(w, &http.Cookie{
			Name:     "oauth_return_to",
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
		})
	}

	// Validate return_to URL
	isSecure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	scheme := "http"
	if isSecure {
		scheme = "https"
	}

	// Validate and use return_to URL, or default to personal workspace (my subdomain)
	redirectURL := validateReturnToURL(returnTo)
	if redirectURL == "" {
		redirectURL = fmt.Sprintf("%s://my.%s", scheme, baseDomain)
	}

	// Create one-time auth code for secure token transfer
	authCode := generateID(32)
	authCodesMutex.Lock()
	authCodes[authCode] = authCodeData{
		token:    token,
		username: user.Login,
		expiry:   time.Now().Add(10 * time.Second), // Short-lived (10s sufficient for modern browsers)
		returnTo: redirectURL,
		used:     false,
	}
	authCodesMutex.Unlock()

	// Redirect with one-time auth code in fragment (not sent to server)
	// Fragment identifiers are not sent in Referer headers or logged by servers
	redirectWithCode := fmt.Sprintf("%s#auth_code=%s", redirectURL, url.QueryEscape(authCode))
	log.Printf("[OAuth] Redirecting to %s with one-time auth code (in fragment)", sanitizeURL(redirectURL))
	http.Redirect(w, r, redirectWithCode, http.StatusFound)
}

func handleExchangeAuthCode(w http.ResponseWriter, r *http.Request) {
	// Record start time for constant-time responses (prevent timing attacks)
	startTime := time.Now()
	// Minimum response time: 50ms to prevent timing-based code validity detection
	const minResponseTime = 50 * time.Millisecond

	// Ensure constant-time response at function exit
	defer func() {
		elapsed := time.Since(startTime)
		if elapsed < minResponseTime {
			time.Sleep(minResponseTime - elapsed)
		}
	}()

	log.Printf("[handleExchangeAuthCode] Called with method=%s path=%s", r.Method, r.URL.Path)
	if r.Method != http.MethodPost {
		log.Printf("[handleExchangeAuthCode] Rejecting non-POST request: %s", r.Method)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// CSRF Protection is handled by Go 1.25's CrossOriginProtection middleware (wraps this handler)
	// It uses Fetch Metadata (Sec-Fetch-Site header) which is more reliable than Origin header

	// Get auth code from request
	var req struct {
		AuthCode string `json:"auth_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.AuthCode == "" {
		http.Error(w, "Missing auth_code", http.StatusBadRequest)
		return
	}

	// Atomically validate and consume auth code (all checks under single lock to prevent TOCTOU race)
	authCodesMutex.Lock()
	data, exists := authCodes[req.AuthCode]

	// Perform all validation checks before releasing lock
	if !exists {
		authCodesMutex.Unlock()
		log.Printf("[OAuth] Invalid or expired auth code from %s", clientIP(r))
		http.Error(w, "Invalid or expired auth code", http.StatusUnauthorized)
		return
	}

	if data.used {
		authCodesMutex.Unlock()
		log.Printf("[SECURITY] Attempt to reuse auth code from %s", clientIP(r))
		http.Error(w, "Auth code already used", http.StatusUnauthorized)
		return
	}

	if time.Now().After(data.expiry) {
		authCodesMutex.Unlock()
		log.Printf("[OAuth] Expired auth code from %s", clientIP(r))
		http.Error(w, "Auth code expired", http.StatusUnauthorized)
		return
	}

	// All validations passed - atomically delete the auth code before releasing lock
	delete(authCodes, req.AuthCode)
	authCodesMutex.Unlock()

	// Return token and username
	response := struct {
		Token    string `json:"token"`
		Username string `json:"username"`
	}{
		Token:    data.token,
		Username: data.username,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode auth exchange response: %v", err)
	}

	log.Printf("[OAuth] Successfully exchanged auth code for user %s", data.username)
}

func handleGetUser(w http.ResponseWriter, r *http.Request) {
	// Get token from Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		http.Error(w, "Missing authorization header", http.StatusUnauthorized)
		return
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == authHeader {
		http.Error(w, "Invalid authorization header", http.StatusUnauthorized)
		return
	}

	// Get user info from GitHub
	ctx := r.Context()
	user, err := userInfo(ctx, token)
	if err != nil {
		log.Printf("Failed to get user info: %v", err)
		http.Error(w, "Failed to get user info", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(user); err != nil {
		log.Printf("Failed to encode user response: %v", err)
	}
}

func exchangeCodeForToken(ctx context.Context, code, redirectURI string) (string, error) {
	// Validate inputs
	if code == "" || redirectURI == "" {
		return "", errors.New("invalid parameters")
	}

	// Additional validation for code length to prevent injection
	if len(code) > 512 {
		return "", errors.New("authorization code too long")
	}

	var tokenResp oauthTokenResponse

	// Retry with exponential backoff for up to 2 minutes
	err := retry.Do(
		func() error {
			// Prepare request
			data := url.Values{}
			data.Set("client_id", *clientID)
			data.Set("client_secret", *clientSecret)
			data.Set("code", code)
			data.Set("redirect_uri", redirectURI)

			reqCtx, cancel := context.WithTimeout(ctx, httpTimeout)
			defer cancel()

			req, err := http.NewRequestWithContext(
				reqCtx,
				http.MethodPost,
				"https://github.com/login/oauth/access_token",
				strings.NewReader(data.Encode()),
			)
			if err != nil {
				return retry.Unrecoverable(err)
			}

			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			req.Header.Set("Accept", "application/json")

			// Make request with timeout
			client := &http.Client{
				Timeout: httpTimeout,
				CheckRedirect: func(_ *http.Request, via []*http.Request) error {
					if len(via) >= 3 {
						return errors.New("too many redirects")
					}
					return nil
				},
			}

			resp, err := client.Do(req)
			if err != nil {
				log.Printf("[RETRY] Token exchange network error (will retry): %v", err)
				return fmt.Errorf("token exchange failed: %w", err)
			}
			defer func() {
				if err := resp.Body.Close(); err != nil {
					log.Printf("Failed to close response body: %v", err)
				}
			}()

			// Retry on 5xx server errors
			if resp.StatusCode >= 500 {
				log.Printf("[RETRY] Token exchange returned %d (will retry)", resp.StatusCode)
				return fmt.Errorf("token exchange returned status %d", resp.StatusCode)
			}

			// Don't retry on 4xx client errors
			if resp.StatusCode != http.StatusOK {
				return retry.Unrecoverable(fmt.Errorf("token exchange returned status %d", resp.StatusCode))
			}

			// Read the entire response body
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				return retry.Unrecoverable(fmt.Errorf("failed to read response body: %w", err))
			}

			// Parse response
			if err := json.Unmarshal(body, &tokenResp); err != nil {
				log.Printf("Failed to parse token response: %v", err)
				return retry.Unrecoverable(fmt.Errorf("failed to parse token response: %w", err))
			}

			if tokenResp.AccessToken == "" {
				log.Printf("Token response error: %s, description: %s", tokenResp.Error, tokenResp.ErrorDescription)
				return retry.Unrecoverable(errors.New("no access token in response"))
			}

			return nil
		},
		retry.Context(ctx),
		retry.Attempts(10),                  // Reasonable number of attempts for 2 minutes
		retry.Delay(100*time.Millisecond),   // Initial delay
		retry.MaxDelay(30*time.Second),      // Cap delay at 30s
		retry.DelayType(retry.BackOffDelay), // Exponential backoff
		retry.MaxJitter(1*time.Second),      // Add jitter
		retry.OnRetry(func(n uint, err error) {
			log.Printf("[RETRY] Attempt %d: %v", n+1, err)
		}),
	)
	if err != nil {
		return "", err
	}

	// Validate token before returning
	if len(tokenResp.AccessToken) < 40 || len(tokenResp.AccessToken) > 255 {
		return "", errors.New("invalid token length")
	}

	// Check token format
	if !strings.HasPrefix(tokenResp.AccessToken, "ghp_") &&
		!strings.HasPrefix(tokenResp.AccessToken, "gho_") &&
		!strings.HasPrefix(tokenResp.AccessToken, "ghs_") &&
		!strings.HasPrefix(tokenResp.AccessToken, "ghu_") {
		return "", errors.New("unknown token format")
	}

	log.Print("Successfully exchanged OAuth code for token")
	return tokenResp.AccessToken, nil
}

func userInfo(ctx context.Context, token string) (*githubUser, error) {
	var user githubUser

	// Retry with exponential backoff for up to 2 minutes
	err := retry.Do(
		func() error {
			reqCtx, cancel := context.WithTimeout(ctx, httpTimeout)
			defer cancel()

			req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, "https://api.github.com/user", http.NoBody)
			if err != nil {
				return retry.Unrecoverable(err)
			}

			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Accept", "application/vnd.github.v3+json")

			client := &http.Client{
				Timeout: httpTimeout,
				CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
					return errors.New("unexpected redirect")
				},
			}

			resp, err := client.Do(req)
			if err != nil {
				log.Printf("[RETRY] GitHub user info network error (will retry): %v", err)
				return err
			}
			defer func() {
				if err := resp.Body.Close(); err != nil {
					log.Printf("Failed to close response body: %v", err)
				}
			}()

			// Retry on 5xx server errors
			if resp.StatusCode >= 500 {
				log.Printf("[RETRY] GitHub user info returned %d (will retry)", resp.StatusCode)
				return fmt.Errorf("unexpected status: %d", resp.StatusCode)
			}

			// Don't retry on 4xx client errors (including 401 unauthorized)
			if resp.StatusCode != http.StatusOK {
				return retry.Unrecoverable(fmt.Errorf("unexpected status: %d", resp.StatusCode))
			}

			if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
				return retry.Unrecoverable(err)
			}

			return nil
		},
		retry.Context(ctx),
		retry.Attempts(10),
		retry.Delay(100*time.Millisecond),
		retry.MaxDelay(30*time.Second),
		retry.DelayType(retry.BackOffDelay),
		retry.MaxJitter(1*time.Second),
		retry.OnRetry(func(n uint, err error) {
			log.Printf("[RETRY] User info attempt %d: %v", n+1, err)
		}),
	)
	if err != nil {
		return nil, err
	}

	log.Printf("Successfully fetched user info for: %s", user.Login)
	return &user, nil
}

func handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	// Only allow GET
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	health := struct {
		Timestamp  time.Time `json:"timestamp"`
		Status     string    `json:"status"`
		Version    string    `json:"version"`
		OAuthReady bool      `json:"oauth_ready"`
	}{
		Status:     "healthy",
		Version:    "1.0.0",
		Timestamp:  time.Now(),
		OAuthReady: *clientID != "" && *clientSecret != "",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(health); err != nil {
		log.Printf("Failed to encode health response: %v", err)
	}
}

// generateID generates a cryptographically secure random ID.
func generateID(bytes int) string {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		// Critical security failure - do not fall back to weak randomness
		panic(fmt.Sprintf("CRITICAL: Failed to generate secure random ID: %v", err))
	}
	return base64.URLEncoding.EncodeToString(b)
}

func clearStateCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
}

// sanitizeURL removes sensitive parameters from URLs for logging.
func sanitizeURL(urlStr string) string {
	u, err := url.Parse(urlStr)
	if err != nil {
		return "[INVALID_URL]"
	}

	// Remove fragment and query parameters
	u.Fragment = ""
	u.RawQuery = ""

	return u.String()
}

func trackFailedAttempt(ip string) {
	failedMutex.Lock()
	defer failedMutex.Unlock()

	now := time.Now()
	cutoff := now.Add(-failedLoginWindow)

	// Clean old attempts - reuse slice to reduce allocations
	valid := failedAttempts[ip][:0]
	for _, t := range failedAttempts[ip] {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	failedAttempts[ip] = append(valid, now)

	// Log if there are too many failed attempts
	if len(failedAttempts[ip]) > maxFailedLogins {
		log.Printf("[SECURITY] Excessive failed auth attempts: ip=%s count=%d window=15min", ip, len(failedAttempts[ip]))
	}

	// Prevent memory exhaustion: periodically clean up IPs with no recent failures
	// This protects against DoS attacks using many different IPs
	if len(failedAttempts)%100 == 0 {
		for oldIP, times := range failedAttempts {
			if len(times) == 0 || (len(times) > 0 && times[len(times)-1].Before(cutoff)) {
				delete(failedAttempts, oldIP)
			}
		}
	}
}

// requestSizeLimiter prevents large request bodies from exhausting server resources.
func requestSizeLimiter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestSize)

		// Check Content-Length header
		if r.ContentLength > maxRequestSize {
			log.Printf("Request too large from %s: %d bytes", clientIP(r), r.ContentLength)
			http.Error(w, "Request too large", http.StatusRequestEntityTooLarge)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// requestLogger logs all HTTP requests and responses.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := w.Header().Get("X-Request-ID")

		// Create a response writer wrapper to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		// Log request
		log.Printf("[%s] %s %s %s from %s", requestID, r.Method, r.URL.Path, r.Proto, clientIP(r))

		next.ServeHTTP(wrapped, r)

		// Log response
		duration := time.Since(start)
		log.Printf("[%s] %d %s in %v", requestID, wrapped.statusCode, http.StatusText(wrapped.statusCode), duration)

		// Log security events with structured data
		switch wrapped.statusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			log.Printf("[SECURITY] [%s] Unauthorized access: method=%s path=%s ip=%s", requestID, r.Method, r.URL.Path, clientIP(r))
		case http.StatusTooManyRequests:
			log.Printf("[SECURITY] [%s] Rate limit exceeded: ip=%s", requestID, clientIP(r))
		case http.StatusInternalServerError:
			log.Printf("[ERROR] [%s] Internal server error: method=%s path=%s ip=%s", requestID, r.Method, r.URL.Path, clientIP(r))
		default:
			// Other status codes don't require special logging
		}
	})
}

type responseWriter struct {
	http.ResponseWriter

	statusCode int
	written    bool
}

func (rw *responseWriter) WriteHeader(code int) {
	if !rw.written {
		rw.statusCode = code
		rw.ResponseWriter.WriteHeader(code)
		rw.written = true
	}
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.written {
		rw.WriteHeader(http.StatusOK)
	}
	return rw.ResponseWriter.Write(b)
}
