// Explicit opt-in network test. Sends only bundled synthetic examples.
import { ApiClient, catalog } from '../dist/index.js';
const client = new ApiClient();
for (const operation of catalog) {
  await client.call(operation.name, operation.example);
  process.stdout.write(`PASS ${operation.name}\n`);
}
const { CodeRunner } = await import('../dist/index.js');
const chained = await new CodeRunner(client).execute(`
  const decoded=await tamperbox.request({method:"POST",path:"/v1/tools/jwt_decode",body:{input:{mediaType:'application/jwt',value:'eyJhbGciOiJub25lIn0.eyJzdWIiOiJleGFtcGxlIn0.'}}});
  const yaml=await tamperbox.request({method:"POST",path:"/v1/tools/json_to_yaml",body:{input:decoded.output}});
  return {output:yaml.output,provenance:yaml.provenance};
`);
if (
  chained.apiCalls !== 2 ||
  chained.result.output.mediaType !== 'application/yaml'
)
  throw Error('Code-mode live chain failed.');
process.stdout.write('PASS live code-mode JWT → YAML chain\n');
