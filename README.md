# `@ubiquity/ts-template`

This template repository includes support for the following:

- TypeScript
- Environment Variables
- Conventional Commits
- Automatic deployment to Cloudflare Pages

## Testing

### Cypress

To test with Cypress Studio UI, run

```shell
yarn cy:open
```

Otherwise, to simply run the tests through the console, run

```shell
yarn cy:run
```

### Jest

To start Jest tests, run

```shell
yarn test
```

## Sync any repository to latest `ts-template`

A bash function that can do this for you:

```bash
sync-branch-to-template() {
  local branch_name
  branch_name=$(git rev-parse --abbrev-ref HEAD)
  local original_remote
  original_remote=$(git remote show | head -n 1)

  # Add the template remote
  git remote add template https://github.com/ubiquity/ts-template

  # Fetch from the template remote
  git fetch template development

  if [ "$branch_name" != "HEAD" ]; then
    # Create a new branch and switch to it
    git checkout -b "chore/merge-${branch_name}-template"

    # Merge the changes from the template remote
    git merge template/development --allow-unrelated-histories

    # Switch back to the original branch
    git checkout "$branch_name"

    # Push the changes to the original remote
    git push "$original_remote" HEAD:"$branch_name"
  else
    echo "You are in a detached HEAD state. Please checkout a branch first."
  fi

  # Remove the template remote
  # git remote remove template
}
```
