# Transit Analytics infrastructure

The environment roots under `environments/` configure providers and remote
state, then call the shared `modules/transit-analytics` module. They do not
declare application resources directly.

## Bootstrap and deploy

Authenticate to the target AWS account, generate the ignored state configuration,
then create the dedicated Terraform state bucket once:

```sh
cd apps/transit-analytics
aws sts get-caller-identity
just configure-state eu-central-1
just bootstrap
```

`infra/state.config` records the exact state bucket and state region selected
at setup time. The generator uses the authenticated account ID only to make the
globally unique bucket name; routine initialization and deployment do not query
STS to select a backend. Re-run the generator only when intentionally changing
the state account or region.

The bootstrap stack deliberately uses ignored local state because Terraform
cannot create an S3 bucket through a backend that does not exist yet. Retain or
back up `infra/bootstrap/state/terraform.tfstate`; the state bucket itself is
protected from Terraform deletion, blocks public access, requires TLS, and has
encryption and versioning enabled.

Create the ignored dev secrets file with freshly rotated Trafiklab credentials,
then initialize and deploy the environment:

```sh
cp infra/environments/dev/secrets.tfvars.example \
  infra/environments/dev/secrets.tfvars
# Edit secrets.tfvars without committing it.
just init dev
just plan dev
just deploy dev
```

`just plan` and `just deploy` build the Lambda before Terraform packages
`dist/`, preventing stale code from being deployed. They do not initialize the
backend: run `just init dev` after a fresh checkout or after provider, module, or
backend changes. CI initializes once in every fresh job. The dev state and lock
live under `transit-analytics/dev/terraform.tfstate` in the dedicated state
bucket.

If the backend location changes, run Terraform initialization explicitly with
`-migrate-state` to move existing state or `-reconfigure` to select an already
populated backend. Routine initialization uses neither flag so Terraform cannot
silently switch the stack's state location.

To add an environment, copy the thin dev root and change its literal
environment name and backend key. Resource definitions remain in the shared
module.

CI/CD will use an environment-specific deployment role authenticated through
GitHub OIDC. Restrict that role to its environment's resources, state key, and
lock key. State needs `s3:GetObject` and `s3:PutObject`; the `.tflock` also needs
`s3:DeleteObject`, and `s3:ListBucket` should be limited to the corresponding
prefix. Terraform additionally needs only the service actions required by this
module and `iam:PassRole` for the exact Lambda execution role, rather than
account-wide administrator access.

## Security

There are no application VPCs or subnets yet. The static fetcher intentionally
runs outside a customer VPC so it can reach public provider feeds; technically,
that is AWS-managed networking rather than a public subnet.

When private subnets are introduced, keep the internet-egress fetcher on the
public side of the trust boundary. Its only data-lake write access must remain
the `raw/*` object prefix. It may additionally read the exact provider secret
and write its own CloudWatch log group, but must not read raw objects or access
normalized and curated prefixes. Downstream compute in private subnets can be
granted the separate permissions needed to read and transform raw data.

The data-lake bucket itself remains private, encrypted, and TLS-only. Network
placement does not replace the IAM and bucket-policy boundary.
