# Contributing

Use Node 22 or later. Run `npm ci`, write a failing behavior or regression test, implement the smallest complete change, then run `npm run check`. The test suite needs loopback networking but no public internet or API credentials. Run `npm run test:live` separately when reviewing API compatibility.

Keep API schemas and their public OpenAPI fixture in sync. Preserve the two-tool discovery/execution interface. Never add host capabilities to the sandbox without adversarial tests and a security review. Do not use Node `vm` as the isolation boundary. Keep error responses and logs free of code, inputs, URLs and tokens.

Use `npm run format` before submitting. Include the user-visible change, validation performed and relevant limits in pull requests. Public examples and fixtures must be synthetic. Do not commit environment files, credentials, private service configuration, local paths or captured user data.
