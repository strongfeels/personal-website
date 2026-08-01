package main

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SecurityHeaders middleware adds security headers to responses
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://meme-api.com; img-src 'self' https://i.redd.it https://preview.redd.it https://external-preview.redd.it https://i.imgur.com https://i.imgflip.com")

		next.ServeHTTP(w, r)

		// Only cache successful responses
		if w.(*responseWriter).statusCode < 400 {
			w.Header().Set("Cache-Control", "public, max-age=86400")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}
	})
}

// LoggingMiddleware logs requests (equivalent to actix Logger)
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap ResponseWriter to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(wrapped, r)

		// Log format similar to actix-web default
		log.Printf("%s %s %d %v", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start))
	})
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// StaticFileServer serves static files with index.html support
func StaticFileServer(staticDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Clean the path and prevent directory traversal
		path := filepath.Clean(r.URL.Path)

		// Convert URL path to file path
		filePath := filepath.Join(staticDir, path)

		// Check if file exists
		info, err := os.Stat(filePath)
		if os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}

		// If it's a directory, serve index.html
		if info.IsDir() {
			// Redirect /dir to /dir/ first. Without the trailing slash the browser
			// resolves that page's relative URLs against the parent directory, so
			// any sub-app served from a folder loads its HTML and then fails to
			// find its own assets. This is what net/http's own FileServer does.
			if !strings.HasSuffix(r.URL.Path, "/") {
				http.Redirect(w, r, r.URL.Path+"/", http.StatusMovedPermanently)
				return
			}
			indexPath := filepath.Join(filePath, "index.html")
			if _, err := os.Stat(indexPath); err == nil {
				filePath = indexPath
			} else {
				http.NotFound(w, r)
				return
			}
		}

		// Set content type based on file extension
		setContentType(w, filePath)

		// Serve the file
		http.ServeFile(w, r, filePath)
	}
}

// setContentType sets the appropriate content type based on file extension
func setContentType(w http.ResponseWriter, filePath string) {
	ext := strings.ToLower(filepath.Ext(filePath))

	contentTypes := map[string]string{
		".html": "text/html; charset=utf-8",
		".css":  "text/css; charset=utf-8",
		".js":   "application/javascript; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".gif":  "image/gif",
		".svg":  "image/svg+xml",
		".ico":  "image/x-icon",
		".woff": "font/woff",
		".woff2": "font/woff2",
	}

	if contentType, exists := contentTypes[ext]; exists {
		w.Header().Set("Content-Type", contentType)
	}
}

// loadTLSConfig loads TLS certificates (equivalent to load_rustls)
func loadTLSConfig() (*tls.Config, error) {
	certPath := "localhost.pem"
	keyPath := "localhost-key.pem"

	// Load certificate and key
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load TLS certificate: %v", err)
	}

	// Create TLS config
	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		ServerName:   "localhost", // Should match your certificate
		MinVersion:   tls.VersionTLS12,
	}

	return tlsConfig, nil
}

func main() {
	// Load TLS configuration
	tlsConfig, err := loadTLSConfig()
	if err != nil {
		log.Fatalf("TLS configuration error: %v", err)
	}

	// Create HTTP mux (router)
	mux := http.NewServeMux()

	// Set up static file serving for all paths
	staticDir := "./static"
	mux.HandleFunc("/", StaticFileServer(staticDir))

	// Apply middleware (equivalent to .wrap() in actix-web)
	handler := LoggingMiddleware(SecurityHeaders(mux))

	// Create HTTPS server
	server := &http.Server{
		Addr:      "0.0.0.0:8443",
		Handler:   handler,
		TLSConfig: tlsConfig,

		// Security timeouts
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	bindAddr := "0.0.0.0:8443"
	fmt.Printf("Serving at https://%s\n", bindAddr)

	// Start HTTPS server
	log.Fatal(server.ListenAndServeTLS("", ""))
}