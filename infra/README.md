# Transit Analytics infrastructure

Each environment configures its providers and S3 backend, then calls the shared
`modules/transit-analytics` module.

## Initialize

Authenticate to the target AWS account (`aws login`) before running these commands.

### State bucket already exists

Generate the ignored backend configuration, then initialize the environment:

```sh
just configure-state <region>
just init <dev prod>
```

If this checkout was previously initialized with another backend, select the
existing backend explicitly:

```sh
just init <dev prod> -reconfigure
```

Use `-migrate-state` instead of `-reconfigure` when moving state to a
different backend:

```sh
just init <dev prod> -reconfigure
just init <dev prod> -migrate-state
just init <dev prod>
```

### State bucket does not exist

Create the bucket before initializing the environment:

```sh
just configure-state <region>
just bootstrap
just init <dev prod>
```

The bootstrap stack uses local state because it creates the remote state
bucket. Retain or back up `infra/bootstrap/state/terraform.tfstate`.

## Deploy

Create and edit the ignored secrets file, then plan and deploy:

```sh
cp environments/dev/secrets.tfvars.example \
  environments/dev/secrets.tfvars
just plan dev
just deploy dev
```

## Security

Keep the internet-facing fetcher limited to writing `raw/*`, reading its exact
secret, and writing its own logs. Grant downstream workloads separate access.
Use environment-specific CI roles scoped to their resources, state, lock file,
and required `iam:PassRole` target.
