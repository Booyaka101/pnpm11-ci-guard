# Examples

Two throwaway sample projects used to demonstrate the tool. **Nothing here is part
of the shipped package** — they exist so you can see real output before pointing
`pnpm11-ci-guard` at your own repo.

## `broken-project/`

A realistic pnpm v10-era setup that upgrades to v11 and breaks silently. It trips
every rule:

```bash
npx pnpm11-ci-guard --dir examples/broken-project
# exits 1
```

## `clean-project/`

The same project after migration. Nothing is reported:

```bash
npx pnpm11-ci-guard --dir examples/clean-project
# exits 0
```
