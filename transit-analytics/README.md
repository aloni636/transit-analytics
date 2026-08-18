# Applications

## Python development

I decided to use `uv` instead of `poetry` because it has better support for workspaces, and I want the enforcement provided by `uv` of consistent package versions across Python projects.

From `./transit-analytics`, install every workspace member with:

```bash
uv sync --all-packages --locked
```

Run commands for the normalization project with `uv run`:

```bash
uv run transit-analytics-normalization python
```

Spin up a Jupyter lab server with package dependencies:

```
uv run --package transit-analytics-normalization \
    --with jupyter jupyter lab
```