# Production Code Mode acceptance — updated 2026-10-19

Endpoint: **https://mcp.tamperbox.dev/mcp**. Authentication: **none**.

The owner authorized replacing the legacy service on this hostname. Cloudflare now routes it to `tamperbox-code-mode`; `api.tamperbox.dev` and `docs.tamperbox.dev` remain on `tamperbox-agents`. This is a tool-interface change: clients must discover and use `search` and `execute`, replacing any legacy tool-name allowlists.

## Deployed artifact

- Worker version: `d4619795-582b-4a0f-88db-2573d7389046`.
- Server version: `0.2.0`.
- Runtime source: `9da3e6acec4f7345485396d1eb02b5fe13dda29e`, the same container artifact verified in the [preview acceptance](hosted-acceptance.md).
- Image digest: `sha256:b23070b9ddf820aa480184ba750b532235c5f2019cd8abe66c14edebaaafc753`.
- Configuration: [wrangler.production.jsonc](../deploy/cloudflare/wrangler.production.jsonc). The digest pin intentionally decouples image promotion from local source edits.
- Public access, four concurrent proxied requests, approximately 60 requests/minute per client/location, a single `standard-1` container, and 30-second idle shutdown. Startup remains bounded to 15 seconds; cold starts may return 503.
- Worker and container logging disabled; workers.dev and version preview URLs disabled.

## Verification

All 15 hosted acceptance checks passed against the actual production URL from **10:00:04 to 10:00:14 UTC on 2026-10-19**:

- HTTPS health and MCP initialization reported version `0.2.0`.
- Exactly `search` and `execute`, with the expected schemas, were discovered.
- Catalog discovery found 58 operations and 53 website entries.
- Isolated execution, live JSON formatting, JWT-to-YAML composition, and public DNS lookup passed.
- Unknown routes, disallowed Origin, unsupported GET, invalid content type, and malformed JSON were rejected as expected; client close passed.

Before the 2026-10-19 configuration redeployment, 303 server tests, 28 adapter tests, package smoke checks, and the production configuration dry run passed. The redeployment retained the previously accepted, digest-pinned runtime image. Production API schema and docs home both returned HTTP 200 after the original cutover. Cloudflare's domain inventory confirmed the API and docs assignments were unchanged.

Reproduce acceptance from the repository root:

```sh
TAMPERBOX_MCP_URL=https://mcp.tamperbox.dev/mcp npm run test:hosted
```

These checks do not establish sustained-load capacity, an uptime commitment, every diagnostic's availability, or provider UI/model acceptance on the new hostname. Earlier CLI and lifecycle evidence applies to the same image on the preview hostname; see its separate record.

## Rollback

The legacy `tamperbox-agents` Worker remains deployed with version `bdf6f8b7-03cd-4a21-90ee-c64579ba5807`; it was not redeployed during this cutover. To restore the old MCP interface, reassign only the `mcp.tamperbox.dev` Custom Domain from `tamperbox-code-mode` to `tamperbox-agents` in Cloudflare. Keep the API and docs domain assignments unchanged, then initialize an MCP client and verify the restored legacy tool list.

Reconcile both repositories' route configuration with any rollback: remove the production MCP route here and restore it in `toolkit-apps/wrangler.agents.jsonc`. Do not deploy the sibling checkout merely to change routing: it may contain unrelated local work. Rolling back a version of the new Worker alone does not restore domain ownership or the legacy implementation.

Before/after Cloudflare domain inventories and the prior deployment metadata were saved locally under `deploy/cloudflare/.artifacts/production-before.json` and `production-after.json` (ignored by Git). They contain no credentials. The legacy custom-domain ID was `1e90442ccbe111946777b3f7103c93b8b40478d2` in zone `df53a3e8eeeb187028694c7602a4f052`.
