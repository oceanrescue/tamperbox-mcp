# Marketplace submission preparation

This directory contains draft listing metadata, five positive and three negative review cases, and the existing Tamperbox icon exported as a 512 × 512 PNG. It is **not an installable or submission-ready plugin**. No portal upload, review submission or marketplace publication has occurred. These preparation files are excluded from the npm package by its existing allowlist.

`plugin.json` uses the intended submission field mappings so supported metadata does not live only in notes. Unknown fields are deliberately absent. A dedicated anonymous HTTPS preview now passes [hosted acceptance](../docs/hosted-acceptance.md). There is still no submission ZIP: publisher details, policy coverage, the eight review cases and an actual demo remain pending. Finalize the portable MCP configuration with the intended submission endpoint before packaging; the preview is not marketplace approval.

## Listing and ownership

- Display name: **Tamperbox tools for modern Web**.
- Subtitle: **Inspect, transform, explain** (27 characters).
- Audience: developers investigating public network configuration or transforming structured text.
- Listing, prompts and cases: [plugin.json](plugin.json).
- Icon: [assets/tamperbox.png](assets/tamperbox.png), reused for the listing and composer. Source: the project's existing `public/favicon.svg`, with only export size/title changed in [assets/tamperbox.svg](assets/tamperbox.svg). The rendered PNG was visually inspected; no new brand identity was invented.
- Verified publisher identity: pending the owner's answer. The repository account `oceanrescue` is not proof of a verified marketplace identity.
- Countries and commerce declaration: pending the owner's answers; neither is inferred from the open-source license or website.
- Category: select an appropriate supported category in the actual dashboard; none has been invented here.

Optional dark-mode variants and brand colors are omitted. The existing mark is used for both contexts; these optional fields do not block preparation.

## Public URLs and policy coverage

The following pages were fetched without authentication and their contents inspected on 2026-10-18. Reachability does not establish that the owner has approved their use for the submitted deployment.

| Field   | Page and observed content                                                                                                                                                           | Preparation status                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website | [Source and product README](https://github.com/oceanrescue/tamperbox-mcp): identifies the project, repository owner, capabilities and limitations.                                  | Included in draft metadata.                                                                                                                                                                                   |
| Support | [GitHub issues](https://github.com/oceanrescue/tamperbox-mcp/issues): public issue list and a New issue action; creating an issue requires GitHub sign-in.                          | Included for ordinary product support. Do not post credentials or vulnerabilities there.                                                                                                                      |
| Privacy | [Tamperbox privacy policy](https://tamperbox.dev/privacy): published page dated 2026-10-15 covers browser/server processing and an agent API section framed around transformations. | Not yet included as an approved plugin policy. Confirm coverage of remote MCP hosting, diagnostic targets, remotely submitted message headers, proxy/hosting logging, retention/deletion and support contact. |
| Terms   | [Tamperbox terms](https://tamperbox.dev/terms): published page dated 2026-10-12 describes responsible tool use, ownership and limitations for the website.                          | Not yet included as approved plugin terms. Confirm application to this API/MCP integration and publisher.                                                                                                     |

The local website source has newer dates than these deployed pages. Do not claim those local changes are already published. Policy amendments and legal attestations need the owner; this packet does not invent retention promises, jurisdiction, commerce terms or a private support channel.

Technical facts available for that review: `search` uses the bundled local contract without API traffic; `execute` sends operation inputs to the configured API. A remote MCP host receives source code and embedded inputs. The model provider receives tool requests/results. Diagnostics can contact public resolvers, registries and selected targets. Remote header analysis sends the supplied headers. The source server does not persist or log tool bodies/results; hosting, gateway and provider policies are separate. See [security](../SECURITY.md) and [architecture](../docs/architecture.md).

## Reviewer walkthrough

All eight model-facing review cases in `plugin.json` are **Not run**. Existing protocol and API tests are evidence for implementation behavior, not for a model's tool choices or final answer. The [acceptance record](../docs/release-acceptance.md) identifies those completed checks separately.

1. Deploy the exact candidate behind HTTPS and run the [deployment acceptance checks](../docs/deployment.md). Confirm that `tools/list` exposes exactly `search` and `execute` and that their required boolean annotations match the source.
2. Connect that endpoint in the intended provider client. Confirm the actual authentication mode. Anonymous access and static bearer access are supported by the server; OAuth is not implemented and requires a separately tested gateway when the client requires it.
3. Start each case in a fresh conversation with the submitted integration enabled. Paste its exact prompt. The case descriptions contain synthetic inputs and public example targets; no private documents or production credentials are needed.
4. Compare actual tool names, method/path/body values, returned evidence and the final answer with `tools_triggered` and `expected_behavior`. Preserve error/unavailable results instead of inventing successful evidence. Negative cases must explain the unsupported action without calling this integration.
5. Record the candidate version, endpoint, provider/model, date, tool trace and Passed/Failed/Blocked result outside public metadata. Redact tokens and unrelated account data. A blocked diagnostic case remains blocked even if error handling was correct.

Review credentials, if required, belong only in the portal's secure access fields. Use a dedicated test identity and verify access independently of the owner's mailbox, phone or private network. Do not add credentials to this directory, the archive, URLs or release assets.

## Demo recording script

Status: **not recorded**. A script is not evidence of a working hosted connection. Use the accepted Code Mode preview in the client's development connection and a screen recorder; a portal submission is not required just to rehearse. Computer control alone does not record video.

| Segment                       | Prompt/action                                                                 | Show on screen                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Setup, about 20 seconds       | Show the connected integration and candidate version.                         | Exactly two tools and the actual deployment identity, without secrets.                                               |
| Discovery, about 30 seconds   | Use the first positive case: ask about DNS and DNSSEC without running checks. | A selective `search` result, required inputs and `apiCalls: 0`; no execute call.                                     |
| Composition, about 45 seconds | Use the synthetic JWT-to-YAML case.                                           | The two API requests inside `execute`, resulting YAML, and the warning that decoding does not verify trust.          |
| Diagnostics, about 45 seconds | Use the DNS/security-headers case.                                            | Real observations and their provenance/limitations; show a genuine unavailable result honestly if one occurs.        |
| Boundary, about 20 seconds    | Use the negative DNS-edit case.                                               | The assistant explains that the integration cannot publish DNS changes, with no tool invocation or claimed mutation. |

Allow time to read results rather than enforcing these approximate timings. Replay the recording to check readability, correct results and absence of secrets. Host it at an owner-approved reviewer-accessible URL, verify playback without private access, and then populate `review.demo_recording_url`. No recording URL is currently present.

## Finalization order

1. Resolve publisher identity, countries and commerce details; confirm policy/terms coverage and support arrangements.
2. Deploy and accept the matching HTTPS server; record its URL and authentication configuration.
3. Run all eight cases and record the real demo. Fix implementation or expectation defects based on intended behavior.
4. Fill only verified metadata, add `mcp.json`, create a separate upload copy, and validate its schema, icon inventory, review cases and absence of private bindings/secrets. Inspect the resulting ZIP.
5. Upload a draft in the intended publisher account only after preparation is complete. Verify imported fields and reviewer access. The authorized owner completes legal/policy attestations; submission and publication are separate steps.

The portable listing is preparation for an OpenAI plugin submission. Other directories may require different forms and fields; do not treat this draft as proof of eligibility or review acceptance elsewhere.
