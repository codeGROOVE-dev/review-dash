# GitHub PR Dashboard

A lightweight, fast dashboard for viewing GitHub pull requests. Can be served statically or via the included secure Go server with OAuth support.

## Features

- **Real GitHub Integration**: Login with GitHub OAuth or Personal Access Token
- **Smart Categorization**: Automatically groups PRs into Incoming, Outgoing, and Drafts
- **Visual Status Indicators**: Color-coded cards show PR status at a glance
- **Security Hardened Go Server**: Optional server with comprehensive security features
- **Demo Mode**: Try the interface with sample data before logging in

## Quick Start

### Static Files (Simple)
```bash
# Just open in browser
open index.html
```

### Go Server (OAuth + Security)
```bash
go build
# Client ID defaults to Iv23liYmAKkBpvhHAnQQ
./dashboard --port=8080 --client-secret=YOUR_SECRET
```

## Go Server Features

### Security
- **CSRF Protection**: Secure state validation
- **Rate Limiting**: 10 req/min per IP on OAuth endpoints  
- **Security Headers**: CSP, X-Frame-Options, HSTS, etc.
- **Request Tracking**: Unique IDs and security event logging
- **Origin Validation**: Configurable CORS with `--allowed-origins`

### Configuration
```bash
# Environment variables
PORT=8080 GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy ./dashboard

# Command line flags
# Defaults: client-id=Iv23liYmAKkBpvhHAnQQ, redirect-uri=https://dash.reviewGOOSE.dev/oauth/callback
./dashboard \
  --port=8080 \
  --client-secret=yyy \
  --redirect-uri=http://localhost:8080/oauth/callback \
  --allowed-origins=http://localhost:8080
```

### Endpoints
- `GET /` - Dashboard
- `GET /health` - Health check  
- `GET /oauth/login` - Start OAuth flow
- `GET /oauth/callback` - OAuth callback

## GitHub OAuth Setup

1. Create OAuth App at GitHub Settings > Developer settings > OAuth Apps
2. Set callback URL to `https://dash.reviewGOOSE.dev/oauth/callback` (or your custom URL)
3. Use the client secret with the Go server (client ID defaults to Iv23liYmAKkBpvhHAnQQ)

## Security Best Practices

When using the Go server:
- **Always use HTTPS in production** - Enables HSTS automatically
- **Set allowed origins** - Use `--allowed-origins` for your domains
- **Monitor logs** - Watch for `[SECURITY]` tagged events
- **Keep updated** - Regular updates for security patches

## File Structure

```
├── index.html       # Dashboard UI
├── main.go          # Secure Go server
├── assets/          # CSS, JS, demo data  
└── go.mod           # Go module file
```
