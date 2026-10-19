# Source and dependency notices

The Tamperbox API contract and synthetic examples are first-party artifacts. The independent public OpenAPI fixture was retrieved from https://docs.tamperbox.dev/openapi.json on 2026-10-17.

The MCP Registry schema fixture was retrieved from https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json on 2026-10-17. Its upstream project is https://github.com/modelcontextprotocol/registry. The fixture is retained solely for validating release metadata against the published schema. The upstream license notice and terms are preserved in `test/fixtures/MCP-REGISTRY-LICENSE`; consult that notice for the project’s licensing transition.

Runtime dependencies, including the official MCP TypeScript SDK and QuickJS/WASM, remain separately licensed packages. Their upstream license and notice files are distributed with those dependencies by npm. This repository's MIT license applies to this repository's original implementation and documentation; it does not replace dependency licenses.
