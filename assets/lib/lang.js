// Substack stores every fenced block with data-lang="", so the language has to be
// inferred from the code itself. tools/build.mjs runs this once and writes the result
// back into the data, so the client only ever reads a settled label.

const lines = (code) => code.split('\n').filter((l) => l.trim());

// The verb must stand alone at the head of the line: `lock.lock();` is Java, and
// without the lookahead its leading `lock` reads as `LOCK IN SHARE MODE`.
const SQL_VERB = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|RENAME|WITH|EXPLAIN|DESCRIBE|SHOW|SET|BEGIN|START|COMMIT|ROLLBACK|GRANT|REVOKE|CALL|PREPARE|ANALYZE|USE|LOCK|UNLOCK|KILL|FLUSH|OPTIMIZE|LOAD\s+DATA|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|STRAIGHT_JOIN|ON|GROUP|ORDER|LIMIT|OFFSET|HAVING|VALUES|UNION|USING|RETURNING|WINDOW|AND|OR|FROM)\b(?![\w.])/i;
const SQL_BODY = /\b(FROM|WHERE|JOIN|ON|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|VALUES|SET|AS|USING|INTO|DUPLICATE\s+KEY|RETURNING|WINDOW|PARTITION\s+BY|OFFSET)\b|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE/i;
const PLAN_OUTPUT = /(actual\s+time=|cost=[\d.]+|rows=\d+\s+loops=|^\s*(->|└|├|├─|└─)\s|Query\s?plan|select_type|possible_keys|^\s*(Buffers|Index\s+Cond|Filter|Rows\s+examined|Extra):)/im;
const ERROR_OUTPUT = /^\s*(ERROR\s?\d*|ERROR:|WARNING\s?\d*:|Warning\s+\d+|HINT:|NOTE:|SLF4J:|Exception in thread|Caused by:|\tat )/m;
const BOX_ART = /[─-╿━-╿▀-▟]|^\s*[+|][-+|]{6,}/m;
const PROPS_LINE = /^\s*[A-Za-z][\w.-]*\s*=(?!\s*$)[^;]*$/;
const YAML_LINE = /^\s*(?:-\s+\S|[A-Za-z_][\w.-]*:(\s+\S|\s*$))/;
const REDIS_CMD = /^\s*(SET|GET|GETSET|GETDEL|MSET|INCR|INCRBY|DECR|EXPIRE|PEXPIRE|TTL|PTTL|PERSIST|DEL|UNLINK|EXISTS|TYPE|HSET|HGET|HGETALL|HMGET|HDEL|HEXISTS|LPUSH|RPUSH|LPOP|RPOP|LRANGE|LLEN|SADD|SREM|SMEMBERS|SISMEMBER|ZADD|ZREM|ZRANGE|ZSCORE|ZRANGEBYSCORE|XADD|XREAD|XGROUP|PUBLISH|SUBSCRIBE|EVAL|EVALSHA|SCRIPT|FLUSHALL|DBSIZE|INFO|CONFIG\s+SET|CLIENT|MULTI|EXEC|WATCH|CLUSTER)\b(\s|$)/i;
const BASH_HEAD = /^\s*(\$ |#|>>)\s|^\s*(sudo|curl|wget|kubectl|helm|docker|apt|apt-get|yum|dnf|brew|git|cd|export|source|chmod|chown|mkdir|echo|cat|grep|awk|sed|systemctl|journalctl|nc|dig|top|htop|ps|kill|jcmd|jstack|jmap|jinfo|java\s+-|go\s+(run|build|test)|mvn|gradle|npm|pnpm|yarn|python3?)\b/;
const BASH_TOOL = /(\.sh\b|bin\/kafka-|--bootstrap-server|--topic\b|--consumer-property|--producer-property|--group\b)/;

const countWhere = (list, test) => list.reduce((n, l) => (test(l) ? n + 1 : n), 0);

const looksJson = (code) => {
  const t = code.trim();
  if (!/^[[{]/.test(t) || !/["'\d[a-z]/i.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
};

export function detectLang(code, declared = '') {
  const explicit = String(declared || '').trim().toLowerCase();
  if (explicit && explicit !== 'text' && explicit !== 'plaintext') return explicit;

  const src = code.trim();
  if (!src) return 'text';
  const rows = lines(src);

  // Console dumps and ASCII diagrams read better unhighlighted than mislabelled.
  if (ERROR_OUTPUT.test(src) && !SQL_VERB.test(rows[0] || '')) return 'text';
  if (PLAN_OUTPUT.test(src) && !/^\s*(SELECT|WITH|EXPLAIN)\b/i.test(src)) return 'text';
  if (BOX_ART.test(src) && countWhere(rows, (l) => SQL_VERB.test(l)) < 2) return 'text';

  if (looksJson(src)) return 'json';
  if (/redis\.call\(|KEYS\[\d|ARGV\[\d/.test(src) && /\bthen\b|\bend\b/.test(src)) return 'lua';
  if (/\brate\(|increase\(|\[\d+[smh]\]\)|sum\s+by\s*\(|avg_over_time|http_requests_total/.test(src)) return 'promql';

  // Redis REPL syntax has no semicolons and no assignments, which separates it from SET in SQL.
  const sqlAnywhere = /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|EXPLAIN|DESCRIBE|CREATE\s+(TABLE|INDEX|USER)|ALTER\s+TABLE|DELETE\s+FROM|EXECUTE|PREPARE|GRANT)\b/i;
  if (!sqlAnywhere.test(src) && !/;/.test(src) && countWhere(rows, (l) => REDIS_CMD.test(l)) >= Math.max(1, rows.length * 0.5)) return 'redis';

  const sqlLines = countWhere(rows, (l) => SQL_VERB.test(l));
  if (sqlLines >= 2) return 'sql';
  if (sqlLines === 1 && (SQL_BODY.test(src) || /;\s*$/.test(src))) return 'sql';
  if (/^\s*(--|\/\*)\s.*(SELECT|JOIN|INDEX|WHERE|LOCK|TRANSACTION)/i.test(src) && sqlLines >= 1) return 'sql';

  const goLines = countWhere(rows, (l) => /^\s*(func|package|type|var|const)\s|:=|\bdefer\b|\bgo\s+func\b|\breturn\b|err\s*!=\s*nil|struct\s*\{|\bchan\b|\bmake\(|\brange\b/.test(l));
  const javaLines = countWhere(rows, (l) => /;\s*(\/\/.*)?$/.test(l) || /\b(public|private|protected|class|interface|record|enum|import|package|new|return|this)\b|@\w+/.test(l));
  const pyLines = countWhere(rows, (l) => /^\s*(def|class|import|from|for|if|while|with|return|print)\b.*[:=]?\s*$/.test(l) && /:\s*$|\bprint\(|\bimport\b/.test(l));

  // One-line snippets (`producer.send(record);`) never reach the two-line threshold above.
  const JAVA_MARK = /^\s*(?:@\w+\s+)*(public|private|protected|static|final|volatile|transient|synchronized|abstract)\b|^\s*[\w<>?,[\].\s]+\s\w+\s*=|^\s*[\w.]+(\.\w+\([^;]*\))+\s*;|^\s*(return|throw|this|super)\b|->|::|\bnew\s+[A-Z]\w*\(|System\.(out|err)\.|@Override/;
  const allJava = rows.every((l) => JAVA_MARK.test(l) || /^\s*(\/\/|\*|\/)/.test(l));
  if (allJava && /;\s*(\/\/.*)?$/m.test(src) && !BASH_TOOL.test(src)) return 'java';

  if (pyLines >= 2 && pyLines > javaLines) return 'python';
  if (javaLines >= 2 && javaLines >= goLines) return 'java';
  if (goLines >= 2) return 'go';

  const bashLines = countWhere(rows, (l) => BASH_HEAD.test(l));
  if (BASH_TOOL.test(src) || bashLines >= 2) return 'bash';

  const propLines = countWhere(rows, (l) => PROPS_LINE.test(l) && !/[()]/.test(l) && !l.includes('//'));
  if (propLines >= 2 && propLines >= rows.length * 0.6 && /[A-Za-z]\.[A-Za-z]/.test(src)) return 'properties';

  const yamlLines = countWhere(rows, (l) => YAML_LINE.test(l) && !/;/.test(l) && !/^\s*"/.test(l));
  if (yamlLines >= 2 && yamlLines >= rows.length * 0.7) return 'yaml';

  return 'text';
}

export const LANG_LABELS = {
  sql: 'SQL',
  java: 'Java',
  go: 'Go',
  python: 'Python',
  bash: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  properties: 'Properties',
  redis: 'Redis',
  lua: 'Lua',
  promql: 'PromQL',
  text: 'Output',
};
