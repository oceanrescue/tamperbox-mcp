# Releasing

This repository is prepared for a public source release, npm distribution and custom MCP integrations. Preparation does not publish the package, deploy a service, reserve a name or secure marketplace acceptance.

## Public GitHub repository

The configured origin is [oceanrescue/tamperbox-mcp](https://github.com/oceanrescue/tamperbox-mcp); package and registry repository metadata use that URL. Confirm account access before pushing or publishing. Enable private vulnerability reporting, dependency alerts, secret scanning and branch protection; require CI checks before release. Review the MIT license and public contact/privacy information with the project owner.

Run `npm ci && npm run check`, `npm audit`, and the opt-in `npm run test:live`. Review `npm pack --dry-run` for accidental data. The package allowlist excludes tests, environment files, Git history, dependencies and local development output other than the built `dist` tree. Ensure the lockfile uses public registry URLs. CI builds and tests without publisher secrets.

## npm

`tamperbox-mcp@0.2.0` was published on 2026-10-18 and accepted from a clean registry installation. This version changes the MCP tool names and execution bridge; see the [expansion record](code-mode-expansion.md). Keep published versions immutable. For subsequent versions, use publishing 2FA or a trusted publishing workflow configured for the actual repository. If direct publishing rejects an authenticated account, npm supports staging the reviewed tarball with `npm stage publish <tarball> --access public`, followed by `npm stage approve <stage-id>` and browser authentication. Staging alone is not publication.

Build and inspect the package, then publish with your authorized npm account:

```sh
npm run check
npm pack --dry-run
npm publish --access public
```

These commands are maintainer instructions, not an automatic publish workflow. After publishing, test installation in a clean environment and verify that `npx -y tamperbox-mcp@0.2.0` initializes and executes a synthetic code call. Keep package, `src/server.ts` and registry versions aligned for subsequent releases.

## Official MCP Registry

`server.json` is validated against the official 2025-12-11 schema, pinned in the test fixtures. It uses the reverse-DNS namespace `dev.tamperbox/tamperbox-mcp`, matching `package.json`'s `mcpName`. This requires proof of control of `tamperbox.dev`; it does not assert that verification has happened. Publish npm first, authenticate with the official publisher using domain verification, then validate and publish according to the [Registry quickstart](https://modelcontextprotocol.io/registry/quickstart) and [authentication guide](https://modelcontextprotocol.io/registry/authentication).

Alternatively, switch both names to `io.github.YOUR-OWNER/tamperbox-mcp` and use GitHub authentication for an account/organization you control. Keep verification keys and publisher tokens outside the repository. Do not add a remote endpoint to registry metadata until that exact endpoint is deployed and tested.

## OpenAI and Anthropic directories

Custom integrations can use the documented stdio or HTTPS configuration immediately after the corresponding build/deployment. Public directories and marketplaces are separate review processes. For OpenAI, follow [plugin submission](https://developers.openai.com/plugins/deploy/submission) after testing the custom connection. Prepare accurate use cases, screenshots/demo, privacy and support URLs, reviewer access when authenticated, and a stable deployed endpoint. Check Anthropic's current connector/directory submission route in your publishing account before applying. No listing or acceptance is claimed by this repository.

Draft listing metadata, five positive and three negative review cases, existing brand assets, URL findings and a recording walkthrough are in [marketplace preparation](https://github.com/oceanrescue/tamperbox-mcp/tree/main/marketplace). This directory is not a submission-ready plugin: publisher declarations, policy coverage, the exact HTTPS endpoint, provider-case execution and a real demo recording remain pending. It is excluded from the npm package and must be finalized in a separate upload copy.

## Release acceptance record

See [the current acceptance record](release-acceptance.md) for completed local checks and the specific provider/deployment checks still needing configuration.

Record the commit, package integrity hash, Node versions, test/coverage output, audit result, live API check date, deployed URL, provider-client results and outstanding account checks. Account verification, DNS/TLS, registry publishing and provider reviews require the actual owner and deployment; local tests cannot establish them.
