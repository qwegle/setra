VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-s -w -X main.version=$(VERSION)"
BIN_DIR := ../../bin

.PHONY: all build clean test

all: build

build:
	@echo "Building setra-runner..."
	go build $(LDFLAGS) -o $(BIN_DIR)/setra-runner ./cmd/server/
	@echo "✓ Built $(BIN_DIR)/setra-runner"

test:
	go test ./... -v

clean:
	rm -f $(BIN_DIR)/setra-runner

cross:
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o $(BIN_DIR)/setra-runner-darwin-arm64 ./cmd/server/
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o $(BIN_DIR)/setra-runner-darwin-amd64 ./cmd/server/
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(BIN_DIR)/setra-runner-linux-amd64 ./cmd/server/
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o $(BIN_DIR)/setra-runner-linux-arm64 ./cmd/server/
	@echo "✓ Built runner cross-platform binaries"
