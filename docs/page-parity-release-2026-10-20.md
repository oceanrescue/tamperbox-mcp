# Page-capability release — updated 24 October 2026

Hosted MCP 0.3.0 is published at `https://mcp.tamperbox.dev/mcp`, without changing
the `search` / `execute` interface or public access. The catalog contains 115
operations across all 55 website tool entries, up from 58 operations.

This is a hosted release. The npm registry package has not been published as
0.3.0 by this workflow; older local installs retain their earlier bundled catalog.

## Deployed artifacts

- Runtime source: `0ca1ba7` on `tool-page/json-yaml-converters`.
- Preview Worker version: `1404fdfe-74d4-4433-9a86-3feabc6d2386`.
- Production Worker version: `242bbac6-0216-4543-a8eb-aa77b18bb049`.
- Verified image: `registry.cloudflare.com/ba7fb8da4369efe63064e1885553f353/tamperbox-code-mode-preview-tamperboxcodemode-mcp@sha256:4659ac38974db3afe72b833dea3d3488e5228c44bb1dbd71edade556db11b224`.
- API contract source: toolkit-apps `b383de4`, adding the JSON-to-YAML and
  YAML-to-JSON page contracts. The site and documentation deployments remain
  separate from this MCP deployment.
- Documentation Worker version: `23e9d149-bec0-4d72-a889-8cfc37a28fee`.

The release was built in an isolated worktree. Existing uncommitted deployment
adapter changes in the main MCP checkout were preserved and were not published.
The API configuration no longer claims the separately owned docs custom domain.

## Verification

- 367 MCP tests pass; package extraction, stdio, sandbox and one-shot client checks pass.
- Coverage: 94.72% statements, 88.88% branches, 95.83% functions, 95.59% lines.
- Complete synthetic REST→MCP acceptance: 115 operations, 118 API requests and
  161 synthetic upstream requests; exact bundled/API contract equality.
- Deployment adapter tests, real Node/QuickJS cancellation integration, image build
  and preview/production dry runs pass.
- All 15 hosted acceptance checks pass on both preview and production: version,
  two-tool discovery, 115 operations/55 entries, isolated execution, selected live
  API operations, rejection boundaries and client close.
- Initial production REST sweep: 109 of 112 executable examples returned
  schema-valid responses. CT discovery was unavailable, BGP lookup timed out, and
  the incident feed lacked its required credential. These are service failures,
  not empty results. After the BGP fix, the API returned HTTP 200 with explicit
  partial evidence in 5.278 seconds; optional routing details remained unavailable.

Schema-valid responses may still contain partial or unavailable evidence.
These tests do not establish every provider's availability, sustained capacity,
browser-device measurements through MCP, or model-provider acceptance.

## Rollback

Restore the previous production image digest
`sha256:1267b514b6de547a0c9ca8b4dc002a4587546b3bab1baf3932eadfd9d6b647d6`
in the existing production configuration and deploy that MCP Worker only.
The prior production Worker version was `f9fc44a2-768f-42d5-89d6-09925f045f21`.
Do not reclaim API or documentation custom domains. The API changes are additive;
the preceding MCP catalog remains usable.
