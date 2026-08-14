set shell := ["bash", "-euo", "pipefail", "-c"]

# List the available Transit Analytics recipes.
default:
    @just --list

# Type-check the static fetcher and Step Functions workflow executor.
check:
    pnpm --dir apps/static-fetcher check
    pnpm --dir apps/sf-workflow-executor check

# Type-check and bundle the static fetcher and Step Functions workflow executor Lambdas.
build:
    pnpm --dir apps/static-fetcher build
    pnpm --dir apps/sf-workflow-executor build

# Run the RustFS integration test and Step Functions workflow executor unit test.
test:
    pnpm --dir apps/static-fetcher test
    pnpm --dir apps/sf-workflow-executor test

# Write the ignored state backend configuration for the authenticated AWS account.
[group('infrastructure initialization')]
configure-state region="eu-central-1":
    account_id="$(aws sts get-caller-identity --query Account --output text)"; \
        printf 'bucket = "%s"\nregion = "%s"\n' \
        "transit-analytics-terraform-state-${account_id}" "{{ region }}" \
        > infra/state.config

# Create or update the Terraform state bucket using local bootstrap state.
[group('infrastructure initialization')]
bootstrap *terraform_args:
    terraform -chdir=infra/bootstrap/state init
    terraform -chdir=infra/bootstrap/state apply \
        -var-file=../../state.config \
        {{ terraform_args }}

# Initialize one environment with its isolated S3 state.
[group('infrastructure initialization')]
init env:
    terraform -chdir="infra/environments/{{ env }}" init \
        -backend-config=../../state.config

# Format all Terraform configurations.
fmt:
    terraform -chdir=infra fmt -recursive

# Check Terraform formatting and validate bootstrap, module, and environment configuration.
validate:
    terraform -chdir=infra fmt -check -diff -recursive
    terraform -chdir=infra/bootstrap/state validate
    for environment_dir in infra/environments/*; do \
        terraform -chdir="$environment_dir" validate; \
    done

# Build the Lambda and create a Terraform plan.
plan env *terraform_args: build validate
    terraform -chdir="infra/environments/{{ env }}" plan \
        {{ terraform_args }}

# Build the Lambda and apply the Terraform deployment.
deploy env *terraform_args: build validate
    terraform -chdir="infra/environments/{{ env }}" apply \
        {{ terraform_args }}

# Run the complete local verification sequence.
verify: build test validate
