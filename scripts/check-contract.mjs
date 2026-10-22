import assert from 'node:assert/strict';
import fs from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const api = await SwaggerParser.validate('docs/api/openapi.yaml');
const fixtures = JSON.parse(fs.readFileSync('docs/api/examples.json', 'utf8'));
assert.equal(api.info.version, fixtures.contractVersion);
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);
const operations = new Map();
for (const [path, methods] of Object.entries(api.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    assert(!operations.has(operation.operationId), `Duplicate operationId ${operation.operationId}`);
    operations.set(operation.operationId, { path, method, operation });
  }
}

function check(schema, value, label) {
  const validate = ajv.compile(schema);
  assert(validate(value), `${label}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
}

const covered = new Set();
for (const example of fixtures.examples) {
  const entry = operations.get(example.operationId);
  assert(entry, `Unknown operation ${example.operationId}`);
  assert.equal(entry.path, example.path);
  assert.equal(entry.method.toUpperCase(), example.method);
  const response = entry.operation.responses[String(example.response.status)];
  assert(response, `${example.name}: status not declared`);
  check(response.content['application/json'].schema, example.response.body, `${example.name} response`);
  check(api.components.schemas[example.responseSchema], example.response.body, `${example.name} named response schema`);
  if (example.requestSchema) {
    const schema = entry.operation.requestBody.content['application/json'].schema;
    check(schema, example.request.body, `${example.name} request`);
    check(api.components.schemas[example.requestSchema], example.request.body, `${example.name} named request schema`);
  }
  for (const parameter of entry.operation.parameters ?? []) {
    const value = parameter.in === 'header'
      ? example.request?.headers?.[parameter.name]
      : parameter.in === 'path' ? example.pathParameters?.[parameter.name] : undefined;
    if (value !== undefined) check(parameter.schema, value, `${example.name} parameter ${parameter.name}`);
    if (example.response.status < 300 && parameter.required) {
      assert.notEqual(value, undefined, `${example.name}: missing ${parameter.name}`);
    }
  }
  for (const [header, value] of Object.entries(example.response.headers ?? {})) {
    assert(response.headers?.[header], `${example.name}: response header not declared`);
    check(response.headers[header].schema, value, `${example.name} response header ${header}`);
  }
  if (example.response.status < 300) covered.add(example.operationId);
  const body = example.response.body;
  const priced = example.responseSchema === 'PaymentResult' ? body.order : body;
  if ('subtotal' in priced) {
    assert.equal(priced.total, priced.subtotal - priced.discount, `${example.name}: incorrect total`);
    assert(priced.discount <= priced.subtotal && priced.total >= 0);
    if ('items' in priced) {
      for (const item of priced.items) {
        assert.equal(item.unitPrice, item.sizePrice + item.toppings.reduce((sum, t) => sum + t.price, 0));
        assert.equal(item.lineTotal, item.unitPrice * item.qty);
      }
      assert.equal(priced.subtotal, priced.items.reduce((sum, i) => sum + i.lineTotal, 0));
    }
  }
  if (example.responseSchema === 'PaymentResult') {
    assert.equal(body.payment.amount, body.order.total);
    assert.equal(body.payment.orderId, body.order.id);
    assert.equal(body.loyaltyPointsEarned, body.payment.status === 'SUCCEEDED' ? Math.floor(body.order.total / 10000) : 0);
    assert.equal(body.order.status, body.payment.status === 'SUCCEEDED' ? 'PAID' : 'PAYMENT_FAILED');
  }
}
for (const id of operations.keys()) assert(covered.has(id), `Missing success fixture: ${id}`);
check(api.components.schemas.ProductDetail, fixtures.seed.product, 'seed catalog');
const requestSchema = api.components.schemas.OrderRequest;
const validOrder = structuredClone(fixtures.examples.find(x => x.name === 'create pending').request.body);
for (const [name, mutate] of [
  ['qty zero', x => { x.items[0].qty = 0; }],
  ['fractional qty', x => { x.items[0].qty = 1.5; }],
  ['missing product', x => { delete x.items[0].productId; }],
  ['duplicate topping', x => { x.items[0].toppingIds.push(x.items[0].toppingIds[0]); }],
  ['client total', x => { x.total = 1; }],
  ['invalid size', x => { x.items[0].size = 'XL'; }],
]) {
  const value = structuredClone(validOrder);
  mutate(value);
  assert(!ajv.compile(requestSchema)(value), `Invalid fixture accepted: ${name}`);
}
const schemaBlocks = file => new Map([...fs.readFileSync(file, 'utf8').matchAll(/\b(model|enum)\s+(\w+)\s*\{([^}]+)\}/g)]
  .filter(match => match[2] !== 'SystemCheck')
  .map(match => [`${match[1]} ${match[2]}`, match[3].replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '')]));
const referenceBlocks = schemaBlocks('docs/diagrams/schema.prisma');
const runtimeBlocks = schemaBlocks('backend/prisma/schema.prisma');
assert.equal(runtimeBlocks.size, referenceBlocks.size, 'Runtime/reference schema model/enum counts differ');
for (const [name, definition] of referenceBlocks) assert.equal(runtimeBlocks.get(name), definition, `Runtime schema differs from ERD reference: ${name}`);
console.log(`Contract valid: ${operations.size} operations, ${fixtures.examples.length} fixtures, 6 invalid-payload checks; runtime schema matches ERD reference.`);
