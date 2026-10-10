set shell := ["bash", "-euo", "pipefail", "-c"]

mod infra

default:
    @just --list

# Type-check the shared registry, static/realtime fetcher, and workflow executor.
check:
    pnpm --dir transit-analytics/shared check
    pnpm --dir transit-analytics/feed-fetcher check
    pnpm --dir transit-analytics/sf-workflow-executor check

# Type-check and bundle the static fetcher and Step Functions workflow executor Lambdas.
build:
    pnpm --dir transit-analytics/feed-fetcher build
    pnpm --dir transit-analytics/sf-workflow-executor build

# Run the RustFS integration test and Step Functions workflow executor unit test.
test:
    pnpm --dir transit-analytics/feed-fetcher test
    pnpm --dir transit-analytics/sf-workflow-executor test
