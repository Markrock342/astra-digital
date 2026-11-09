# Deploy the shared demo from GitHub

Every push runs the production build, business/API tests and browser workflows on GitHub-hosted runners. A successful push to `main` (including a merged pull request) then deploys Worker `astra` and Pages project `astra-demo`. Both customer and merchant views keep their existing URLs. Collaborators with write access can push; they do not need Cloudflare accounts or tokens on their computers.

Other branches and pull requests run checks without publishing over the customer demo. Use a feature branch and merge when ready. Concurrent deployments are serialized, and an old run checks the latest main SHA before it starts publishing. A failed build/test prevents deployment. Runtime secrets and durable database contents are preserved; no reset or secret rotation command runs.

## One-time Cloudflare credential

The local Wrangler OAuth login is not a CI credential. Create a dedicated Cloudflare API token with only the following account permissions for account `ca63f6386985a309f86276da80b03111`:

- Account / Workers Scripts / Edit (deploy existing Worker and its Durable Object binding)
- Account / Cloudflare Pages / Edit (deploy the existing Pages project and service binding)
- Account / Account Settings / Read (Wrangler account/authentication lookup)

Do not grant DNS, domain, billing or API-token administration access. Use an expiration date and rotate the token before it expires. The API permissions above are scoped to this Cloudflare account; Cloudflare may still grant access to other Workers/Pages in that account, so keep repository write access limited to trusted collaborators.

Create the token at https://dash.cloudflare.com/profile/api-tokens, then save the value directly in **Settings → Secrets and variables → Actions → New repository secret** at https://github.com/Markrock342/astra-digital/settings/secrets/actions/new, with name `CLOUDFLARE_API_TOKEN`. Do not paste it into chat or commit it to Git.

Repository variable `CLOUDFLARE_ACCOUNT_ID` contains the account identifier. The existing `SPACE_SIGNING_KEY` and `INVENTORY_KEY` remain in Cloudflare runtime secrets and must not be copied to GitHub or regenerated for deployment.

After saving the secret, rerun the failed deployment job (or run **Test and deploy demo → Run workflow → main**). The release job checks the public build stamp and API health before reporting success.

## Working with friends

```sh
git clone https://github.com/Markrock342/astra-digital.git
cd astra-digital
npm ci
git switch -c feature/my-change
# edit, build and test
npm run build
npm test
git add <changed-files>
git commit -m "Describe the change"
git push -u origin feature/my-change
```

Open a pull request into `main`, wait for **Build and test**, then merge. A direct push to `main` also deploys after checks pass. There is no author-name restriction; any authorized collaborator's commit is handled the same way.

Status and logs: https://github.com/Markrock342/astra-digital/actions. The demo deployment is independent of this laptop being online. GitHub/Cloudflare usage remains subject to the account's existing quotas and plans; this setup does not purchase a plan.
