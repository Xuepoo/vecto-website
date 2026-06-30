default:
    @just --list

edit:
    @echo "=== Starting Zola Dev Server & Bun Watcher ==="
    @bun run dev

status:
    @echo "=== Checking repository status ==="
    @git status

test:
    @echo "=== Running quality gates ==="
    @if command -v pre-commit &>/dev/null; then pre-commit run --all-files; else echo "pre-commit not found"; fi

deploy: test
    @echo "=== Building Astro site ==="
    @bun run build
    @echo "=== Deploying to Cloudflare Pages ==="
    @./scripts/deploy-pages.sh dist vecto-ui main

commit message="":
    @if [ -z "{{message}}" ]; then \
        echo "Error: Commit message required. Usage: just commit \"feat(website): update layout\""; \
        exit 1; \
    fi
    @git add -A
    @git commit -m "{{message}}"

push:
    @echo "=== Pushing commits to GitHub ==="
    @git push origin main
