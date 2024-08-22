#!/bin/bash

REPO="jordan-ae/devpool-directory"
AUTHORIZED_ORG_IDS=(76412717 133917611 165700353)

# Fetch issues with author login and author association (organization info might be absent)
issues=$(gh issue list --repo "$REPO" --limit 100 --json number,author,title)

# Check if issues JSON is valid
if [[ -z "$issues" || "$issues" == "[]" ]]; then
    echo "No issues found or invalid JSON."
    exit 0
fi

# Process each issue
echo "$issues" | jq -c '.[]' | while read -r issue; do
    issue_number=$(echo "$issue" | jq -r '.number')
    issue_author_login=$(echo "$issue" | jq -r '.author.login')
    issue_title=$(echo "$issue" | jq -r '.title')
    author_association=$(echo "$issue" | jq -r '.authorAssociation')

    if [[ ! " ${AUTHORIZED_ORG_IDS[@]} " =~ " ${issue_author_login} " && "$author_association" != "OWNER" ]]; then
        echo "Deleting unauthorized issue: #$issue_number $issue_title (by $issue_author_login)..."
        gh issue delete "$issue_number" --repo "$REPO" --yes
    fi
done

echo "All unauthorized issues have been deleted."