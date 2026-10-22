import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const api = yaml.load(fs.readFileSync('docs/api/openapi.yaml', 'utf8'));
function typeOf(schema) {
  if (schema.$ref) return schema.$ref.split('/').at(-1);
  let type;
  if (schema.enum) type = schema.enum.map(x => JSON.stringify(x)).join(' | ');
  else if (schema.type === 'array') type = `Array<${typeOf(schema.items)}>`;
  else if (schema.type === 'object') {
    type = `{ ${Object.entries(schema.properties ?? {}).map(([name, value]) =>
      `${JSON.stringify(name)}${schema.required?.includes(name) ? '' : '?'}: ${typeOf(value)};`).join(' ')} }`;
  } else if (schema.type === 'integer' || schema.type === 'number') type = 'number';
  else if (schema.type === 'string') type = 'string';
  else if (schema.type === 'boolean') type = 'boolean';
  else throw new Error(`Unsupported schema: ${JSON.stringify(schema)}`);
  return schema.nullable ? `${type} | null` : type;
}
const output = '// Generated from docs/api/openapi.yaml. Run npm run api:types; do not edit.\n'
  + Object.entries(api.components.schemas).map(([name, schema]) => `export type ${name} = ${typeOf(schema)};`).join('\n') + '\n';
for (const target of ['backend/src/common/contracts/api.generated.ts', 'frontend/src/lib/contracts/api.generated.ts']) {
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== output) {
      throw new Error(`${target} is stale; run npm run api:types`);
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
  }
}
console.log(`API types ${process.argv.includes('--check') ? 'verified' : 'generated'} for backend and frontend.`);
