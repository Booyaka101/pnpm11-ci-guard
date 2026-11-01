'use strict';

const yaml = require('js-yaml');

/** Index explicit YAML nodes only. Aliases and merges never borrow edit locations. */
function yamlSource(source) {
  const stack = [];
  let root;
  for (const event of yaml.parseEvents(source)) {
    if (event.type === yaml.EVENT_ID.POP) {
      stack.pop();
      continue;
    }
    const node = { event, children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root = node;
    if ([yaml.EVENT_ID.DOCUMENT, yaml.EVENT_ID.MAPPING, yaml.EVENT_ID.SEQUENCE].includes(event.type)) {
      stack.push(node);
    }
  }

  function pair(node, key) {
    if (!node || node.event.type !== yaml.EVENT_ID.MAPPING) return null;
    for (let i = 0; i < node.children.length; i += 2) {
      const candidate = node.children[i];
      if (candidate.event.type === yaml.EVENT_ID.SCALAR &&
          yaml.getScalarValue(source, candidate.event) === key) {
        return [candidate, node.children[i + 1]];
      }
    }
    return null;
  }

  function explicit(path) {
    let node = root && root.children[0];
    for (const part of path) {
      if (!node || node.event.anchorStart >= 0 || node.event.tagStart >= 0 ||
          (node.event.style === yaml.COLLECTION_STYLE.FLOW &&
           node.event.type !== yaml.EVENT_ID.SCALAR)) return null;
      if (node.event.type === yaml.EVENT_ID.SEQUENCE && typeof part === 'number') {
        node = node.children[part];
      } else {
        const entry = pair(node, part);
        node = entry && entry[1];
      }
    }
    if (!node || node.event.anchorStart >= 0 || node.event.tagStart >= 0) return null;
    return node;
  }

  const lineAt = (offset) => source.slice(0, offset).split('\n').length;
  const lines = source.split(/\r?\n/);
  const runOffsets = new Map();

  return {
    envKeyLine(path, key) {
      const mapping = explicit(path);
      if (!mapping || mapping.event.style !== yaml.COLLECTION_STYLE.BLOCK) return null;
      const entry = pair(mapping, key);
      if (!entry) return null;
      const event = entry[0].event;
      if (event.anchorStart >= 0 || event.tagStart >= 0) return null;
      const line = lineAt(event.valueStart);
      const raw = lines[line - 1];
      // Require a literal, standalone key token, not an escaped or complex key.
      const token = raw.trimStart();
      if (![key, `'${key}'`, `"${key}"`].some((k) => token.startsWith(k) &&
          /^\s*:/.test(token.slice(k.length)))) return null;
      return line;
    },
    runLine(path, invocation) {
      const node = explicit(path);
      if (!node || node.event.type !== yaml.EVENT_ID.SCALAR) return null;
      const { valueStart, valueEnd } = node.event;
      const raw = source.slice(valueStart, valueEnd);
      const offset = raw.indexOf(invocation.segment, runOffsets.get(node) || 0);
      if (offset >= 0) runOffsets.set(node, offset + invocation.segment.length);
      return lineAt(valueStart + (offset < 0 ? 0 : offset));
    },
  };
}

module.exports = { yamlSource };
