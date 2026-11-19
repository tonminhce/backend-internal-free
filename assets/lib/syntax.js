import { escapeHtml } from './text.js';

/* Dependency-free tokeniser. Substack stored no language metadata, so tools/build.mjs
   infers one (see lib/lang.js) and writes it into <pre data-lang>. The reader calls
   highlight() on render, so the stored JSON stays free of markup noise.
   Classes map to the --code-* tokens in app.css (GitHub Light+ / Dark+). */

const kw = (words) => ['k', new RegExp(`\\b(?:${words.join('|')})\\b`, 'y')];

const C_LINE = ['c', /\/\/[^\n]*/y];
const C_HASH = ['c', /#[^\n]*/y];
const C_BLOCK = ['c', /\/\*[\s\S]*?\*\//y];
const S_DQ = ['s', /"(?:[^"\\\n]|\\.)*"/y];
const S_SQ = ['s', /'(?:[^'\\\n]|\\.)*'/y];
const S_BT = ['s', /`[^`\n]*`/y];
const NUM = ['n', /\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?[lLfFdD]?\b|\b0[xX][0-9a-fA-F_]+\b/y];
/* Punctuation is consumed as a run (cheap) but left uncoloured — GitHub highlights neither
   brackets nor operators, and tinting them makes the whole block look grey. */
const PUNCT = ['', /[(){}[\],;:.!?]|=>|->|::|\+\+|--|&&|\|\||[+\-*/%<>=&|^~]+/y];
const FN = ['f', /[A-Za-z_$][\w$]*(?=\s*\()/y];
const TYPE = ['t', /\b[A-Z][A-Za-z0-9_]*\b/y];
const IDENT = ['', /[A-Za-z_$][\w$]*/y];
const WS = ['', /\s+/y];

const lang = (rules) => [WS, ...rules, IDENT, PUNCT];
const clike = (keywords) => lang([C_LINE, C_BLOCK, S_DQ, S_SQ, NUM, kw(keywords), FN, TYPE]);

// A Map, not an object: `data-lang="constructor"` must not inherit a rule set from
// Object.prototype and hand highlight() an uniterable value.
const RULES = new Map(Object.entries({
  sql: lang([
    ['c', /--[^\n]*|\/\*[\s\S]*?\*\//y],
    ['s', /'(?:[^']|'')*'|(?:"(?:[^"]|"")*)"/y],
    ['b', /@[a-zA-Z_][\w.]*|\$\{?\w+\}?|:\w+/y],
    ['t', /`[^`]*`/y],
    NUM,
    kw([
      'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'ILIKE', 'RLIKE',
      'BETWEEN', 'EXISTS', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'REPLACE',
      'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'USER', 'ROLE', 'GRANT', 'REVOKE', 'ON', 'TO',
      'ALTER', 'ADD', 'COLUMN', 'DROP', 'TRUNCATE', 'RENAME', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
      'UNIQUE', 'CONSTRAINT', 'DEFAULT', 'AUTO_INCREMENT', 'IDENTITY', 'ENGINE', 'CHARACTER', 'COLLATE',
      'CHARSET', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH', 'JOIN', 'INNER', 'LEFT',
      'RIGHT', 'FULL', 'OUTER', 'CROSS', 'STRAIGHT_JOIN', 'NATURAL', 'USING', 'UNION', 'ALL', 'DISTINCT',
      'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'CONVERT', 'INTERVAL', 'ASC', 'DESC', 'FOR',
      'SHARE', 'MODE', 'LOCK', 'UNLOCK', 'BEGIN', 'COMMIT', 'ROLLBACK', 'START', 'TRANSACTION', 'WORK',
      'WITH', 'RECURSIVE', 'RETURNING', 'WINDOW', 'OVER', 'PARTITION', 'ROWS', 'RANGE', 'PRECEDING',
      'FOLLOWING', 'CURRENT', 'ROW', 'EXPLAIN', 'ANALYZE', 'DESCRIBE', 'SHOW', 'USE', 'FLUSH', 'STATUS',
      'VARIABLES', 'GLOBAL', 'SESSION', 'PROCESSLIST', 'TABLES', 'COLUMNS', 'TRIGGERS', 'PROCEDURE',
      'FUNCTION', 'TRIGGER', 'BEFORE', 'AFTER', 'EACH', 'STATEMENT', 'IF', 'WHILE', 'LOOP', 'DECLARE',
      'SIGNAL', 'TRUE', 'FALSE', 'ENUM', 'JSON', 'GENERATED', 'STORED', 'VIRTUAL', 'ALGORITHM', 'INSTANT',
      'INPLACE', 'COPY', 'FORCE', 'IGNORE', 'DUPLICATE', 'LOAD', 'DATA', 'KILL', 'BINARY', 'DUMPFILE',
      'OUTFILE', 'ISOLATION', 'LEVEL', 'READ', 'WRITE', 'COMMITTED', 'REPEATABLE', 'SERIALIZABLE',
      'AUTOCOMMIT', 'VACUUM', 'REINDEX', 'CHECKPOINT', 'OPTIMIZER', 'COST',
    ]),
    FN,
  ]),

  java: clike([
    'public', 'private', 'protected', 'class', 'interface', 'record', 'enum', 'extends', 'implements',
    'new', 'return', 'this', 'super', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
    'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'static', 'final', 'void', 'int',
    'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'var', 'package', 'import',
    'instanceof', 'synchronized', 'volatile', 'transient', 'abstract', 'native', 'sealed', 'permits',
    'yield', 'assert', 'null', 'true', 'false',
  ]).concat([['t', /@[A-Za-z_]\w*/y]]),

  go: lang([
    C_LINE, C_BLOCK, S_DQ, S_BT, NUM,
    kw([
      'package', 'import', 'func', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go',
      'defer', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue',
      'select', 'fallthrough', 'nil', 'true', 'false', 'string', 'int', 'int8', 'int32', 'int64',
      'uint64', 'float64', 'bool', 'byte', 'rune', 'error', 'any',
    ]),
    ['b', /\b(?:make|len|cap|append|new|close|copy|delete|panic|recover|print|println|fmt|err|ctx)\b/y],
    FN, TYPE,
  ]),

  python: lang([
    ['c', /#[^\n]*/y],
    ['s', /[fbruF]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/y],
    ['t', /@[A-Za-z_][\w.]*/y],
    NUM,
    kw([
      'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as', 'with',
      'try', 'except', 'finally', 'raise', 'lambda', 'None', 'True', 'False', 'and', 'or', 'not', 'in',
      'is', 'pass', 'yield', 'global', 'nonlocal', 'assert', 'del', 'async', 'await', 'break',
      'continue', 'self',
    ]),
    ['b', /\b(?:print|len|range|str|int|float|list|dict|set|tuple|open|enumerate|zip|sum|min|max|abs|sorted|type|isinstance|super|repr)\b/y],
    FN, TYPE,
  ]),

  bash: lang([
    C_HASH,
    ['s', /"(?:[^"\\]|\\.)*"|'[^']*'/y],
    ['b', /\$\{[^}]*\}|\$[A-Za-z_]\w*|\$\d|\$\$|\$@/y],
    ['t', /(?:^|(?<=[\s|;(]))-{1,2}[A-Za-z][\w-]*/y],
    NUM,
    kw([
      'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'case', 'esac', 'function',
      'export', 'local', 'readonly', 'return', 'source', 'echo', 'exit', 'set', 'shift', 'trap', 'wait',
      'break', 'continue',
    ]),
    FN,
  ]),

  json: lang([
    ['t', /"(?:[^"\\]|\\.)*"(?=\s*:)/y],
    S_DQ,
    kw(['true', 'false', 'null']),
    NUM,
  ]),

  yaml: lang([
    C_HASH,
    S_DQ,
    S_SQ,
    ['t', /[\w.$[\]-]+(?=\s*:)/y],
    ['b', /\b(?:true|false|null|yes|no|on|off)\b/y],
    ['p', /\b[|>&][-+]?\b/y],
    NUM,
  ]),

  properties: [
    WS,
    ['c', /#[^\n]*|\/\/[^\n]*/y],
    ['b', /\$\{[^}]*\}/y],
    ['s', /"(?:[^"\\]|\\.)*"|'[^']*'/y],
    ['t', /^[ \t]*[\w.[\]-]+(?=[ \t]*=)/my],
    ['p', /=/y],
    NUM,
    ['', /[^\s=]+/y],
  ],

  redis: lang([
    ['c', /\/\/[^\n]*|#[^\n]*/y],
    S_DQ,
    S_SQ,
    ['p', /\d+:\d+>\s*|\(\d+\)\s|>\s/y],
    kw([
      'SET', 'GET', 'GETSET', 'GETDEL', 'GETEX', 'MSET', 'MGET', 'SETNX', 'SETEX', 'PSETEX', 'INCR',
      'INCRBY', 'INCRBYFLOAT', 'DECR', 'APPEND', 'STRLEN', 'EXPIRE', 'PEXPIRE', 'EXPIREAT', 'TTL',
      'PTTL', 'PERSIST', 'DEL', 'UNLINK', 'EXISTS', 'TYPE', 'KEYS', 'SCAN', 'HSET', 'HMSET', 'HGET',
      'HGETALL', 'HMGET', 'HDEL', 'HEXISTS', 'HKEYS', 'HVALS', 'HINCRBY', 'HLEN', 'LPUSH', 'RPUSH',
      'LPOP', 'RPOP', 'LRANGE', 'LLEN', 'LREM', 'LTRIM', 'LMOVE', 'SADD', 'SREM', 'SMEMBERS',
      'SISMEMBER', 'SCARD', 'SINTER', 'SUNION', 'SDIFF', 'ZADD', 'ZREM', 'ZRANGE', 'ZRANGEBYSCORE',
      'ZREVRANGE', 'ZSCORE', 'ZCARD', 'ZCOUNT', 'ZRANK', 'XADD', 'XREAD', 'XREADGROUP', 'XACK',
      'XGROUP', 'XINFO', 'XRANGE', 'XLEN', 'PUBLISH', 'SUBSCRIBE', 'UNSUBSCRIBE', 'PSUBSCRIBE', 'EVAL',
      'EVALSHA', 'SCRIPT', 'MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH', 'FLUSHALL', 'FLUSHDB',
      'DBSIZE', 'INFO', 'CONFIG', 'CLIENT', 'CLUSTER', 'AUTH', 'SELECT', 'PING', 'SAVE', 'BGSAVE',
      'MEMORY', 'OBJECT', 'NX', 'XX', 'EX', 'PX', 'EXAT', 'PXAT', 'KEEPTTL', 'GET', 'WITHSCORES', 'BYSCORE',
      'LIMIT', 'STREAMS', 'BLOCK', 'GROUP', 'CONSUMERS', 'MAXLEN', 'IDLE', 'COUNT', 'MATCH', 'NOMKSTREAM',
      'JSON', 'FT', 'TS',
    ]),
    NUM,
  ]),

  lua: lang([
    ['c', /--\[\[[\s\S]*?\]\]|--[^\n]*/y],
    S_DQ,
    S_SQ,
    NUM,
    kw([
      'local', 'function', 'end', 'then', 'do', 'if', 'elseif', 'else', 'return', 'and', 'or', 'not',
      'nil', 'true', 'false', 'for', 'while', 'repeat', 'until', 'in', 'break',
    ]),
    ['b', /\b(?:redis|KEYS|ARGV|pcall|table|string|math|ipairs|pairs|tostring|tonumber|error)\b/y],
    FN,
  ]),

  promql: lang([
    C_HASH,
    S_DQ,
    S_BT,
    ['b', /\[[\w]+(?=\])|\b(?:by|on|without|ignoring|offset)\b/y],
    kw([
      'rate', 'irate', 'increase', 'delta', 'sum', 'avg', 'min', 'max', 'count', 'topk', 'bottomk',
      'histogram_quantile', 'quantile', 'label_replace', 'abs', 'ceil', 'floor', 'round', 'clamp_max',
      'clamp_min', 'idelta', 'deriv', 'predict_linear', 'vector', 'scalar', 'avg_over_time',
      'max_over_time', 'min_over_time', 'sum_over_time', 'count_over_time',
    ]),
    ['n', /\b\d+(?:\.\d+)?[smhdwy]\b/y],
    NUM,
    FN,
  ]),
}));

export const canHighlight = (l) => RULES.has(l);

export function highlight(code, langName) {
  const rules = RULES.get(langName);
  if (!rules) return escapeHtml(code);
  let out = '';
  let i = 0;
  while (i < code.length) {
    let hit = false;
    for (const [cls, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (!m || !m[0].length) continue;
      out += cls ? `<span class="tk-${cls}">${escapeHtml(m[0])}</span>` : escapeHtml(m[0]);
      i += m[0].length;
      hit = true;
      break;
    }
    if (!hit) {
      out += escapeHtml(code[i]);
      i += 1;
    }
  }
  return out;
}
