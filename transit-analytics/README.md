# Applications

## Python development

I decided to use `uv` instead of `poetry` because it has better support for workspaces, and I want the enforcement provided by `uv` of consistent package versions across Python projects.

From the repository root, install every workspace member with:

```bash
uv sync --project transit-analytics --all-packages --locked
```

Run commands for the normalization project with `uv run`:

```bash
uv run --project transit-analytics \
    --package transit-analytics-normalization python
```