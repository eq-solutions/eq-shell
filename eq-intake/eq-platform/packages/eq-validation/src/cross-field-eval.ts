/**
 * @eq/validation — cross-field rule evaluator
 *
 * Safe expression language for x-eq-cross-field-rules. NO eval, NO Function constructor.
 * Parses to an AST, walks it. Rejects anything outside the supported grammar.
 *
 * Grammar (informal):
 *   expr        ::= or_expr
 *   or_expr     ::= and_expr ('OR' and_expr)*
 *   and_expr    ::= not_expr ('AND' not_expr)*
 *   not_expr    ::= 'NOT' cmp_expr | cmp_expr
 *   cmp_expr    ::= add_expr (cmp_op add_expr)?
 *   cmp_op      ::= '==' | '!=' | '>' | '<' | '>=' | '<='
 *   add_expr    ::= mul_expr (('+'|'-') mul_expr)*
 *   mul_expr    ::= primary (('*'|'/') primary)*
 *   primary     ::= literal | field_ref | array_call | '(' expr ')'
 *   array_call  ::= field_ref '.' ('length' | method_call)
 *   method_call ::= ('every' | 'some') '(' lambda ')'
 *   lambda      ::= identifier '=>' expr
 *   field_ref   ::= identifier ('.' identifier)*
 *   literal     ::= number | "'" string "'" | 'true' | 'false' | 'null'
 *
 * Maximum AST depth: 8 (prevents pathological nesting).
 *
 * Supported operations:
 *   - Comparison: ==, !=, >, <, >=, <=
 *   - Logical: AND, OR, NOT
 *   - Field reference: field_name, nested.field
 *   - Array helpers: array.length, array.every(x => ...), array.some(x => ...)
 *   - Arithmetic: +, -, *, /
 *   - Literals: numbers, strings ('single quotes'), true, false, null
 *
 * Examples (from canonical schemas):
 *   - "end_date == null OR end_date >= start_date"
 *   - "valid_until == null OR valid_from == null OR valid_until > valid_from"
 *   - "status != 'active' OR signatures.length > 0"
 *   - "hazards.every(h => h.controls.length > 0)"
 */

/**
 * AST-depth ceiling. Limits logical complexity of a single rule.
 * Walked on the final AST after parsing — not parser-recursion depth, so
 * paren nesting doesn't unfairly penalise simple expressions.
 *
 *   `(a == 1 AND b == 1) OR (c == 1 AND d == 1)` → AST depth 3 (fine).
 *   7 left-associative ANDs                       → AST depth 8 (at limit).
 *   8 left-associative ANDs                       → AST depth 9 (rejected).
 */
const MAX_AST_DEPTH = 8;

/**
 * Parser-recursion ceiling — pure stack safety guard. Has to be wider than
 * MAX_AST_DEPTH because parens force the parser to re-enter every level of
 * the grammar (Or → And → Cmp → Add → Mul → Primary → '(' → Or → …).
 * 100 covers every plausibly-authored rule without letting a malicious one
 * blow the JS stack.
 */
const MAX_PARSER_DEPTH = 100;

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'dot' }
  | { t: 'arrow' }
  | { t: 'eof' };

type Node =
  | { type: 'literal'; value: number | string | boolean | null }
  | { type: 'field'; path: string[] }
  | { type: 'binop'; op: string; left: Node; right: Node }
  | { type: 'unop'; op: string; arg: Node }
  | { type: 'array_length'; target: Node }
  | { type: 'array_method'; method: 'every' | 'some'; target: Node; param: string; body: Node };

// ============================================================================
// LEXER
// ============================================================================

function tokenize(src: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;

    if (/\s/.test(c)) { i++; continue; }

    // Numbers
    if (/\d/.test(c)) {
      let j = i;
      while (j < n && /[\d.]/.test(src[j]!)) j++;
      tokens.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }

    // Strings (single quotes)
    if (c === "'") {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== "'") {
        if (src[j] === '\\' && j + 1 < n) {
          s += src[j + 1];
          j += 2;
        } else {
          s += src[j];
          j++;
        }
      }
      if (j >= n) throw new Error('Unterminated string literal.');
      tokens.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }

    // Identifiers & keywords
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      switch (word) {
        case 'true': tokens.push({ t: 'bool', v: true }); break;
        case 'false': tokens.push({ t: 'bool', v: false }); break;
        case 'null': tokens.push({ t: 'null' }); break;
        case 'AND':
        case 'and':  tokens.push({ t: 'op', v: 'AND' }); break;
        case 'OR':
        case 'or':   tokens.push({ t: 'op', v: 'OR' }); break;
        case 'NOT':
        case 'not':  tokens.push({ t: 'op', v: 'NOT' }); break;
        default:     tokens.push({ t: 'ident', v: word });
      }
      i = j;
      continue;
    }

    // Multi-char operators
    if ((c === '=' || c === '!' || c === '<' || c === '>') && src[i + 1] === '=') {
      tokens.push({ t: 'op', v: src.slice(i, i + 2) });
      i += 2;
      continue;
    }

    // Arrow =>
    if (c === '=' && src[i + 1] === '>') {
      tokens.push({ t: 'arrow' });
      i += 2;
      continue;
    }

    // Single-char operators
    if ('+-*/<>'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }

    if (c === '(') { tokens.push({ t: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ t: 'rparen' }); i++; continue; }
    if (c === '.') { tokens.push({ t: 'dot' }); i++; continue; }
    if (c === '=') {
      // Plain '=' is not allowed (must be == or =>)
      throw new Error(`Unexpected '=' at position ${i}. Use '==' for equality or '=>' for lambda.`);
    }

    throw new Error(`Unexpected character '${c}' at position ${i}.`);
  }

  tokens.push({ t: 'eof' });
  return tokens;
}

// ============================================================================
// PARSER (recursive descent)
// ============================================================================

class Parser {
  private pos = 0;
  private depth = 0;
  constructor(private tokens: Tok[]) {}

  parse(): Node {
    const expr = this.parseOr();
    if (this.peek().t !== 'eof') {
      throw new Error('Unexpected trailing tokens.');
    }
    return expr;
  }

  private peek(): Tok { return this.tokens[this.pos]!; }
  private next(): Tok { return this.tokens[this.pos++]!; }
  private expect<T extends Tok['t']>(t: T): Extract<Tok, { t: T }> {
    const tok = this.next();
    if (tok.t !== t) throw new Error(`Expected ${t}, got ${tok.t}.`);
    return tok as Extract<Tok, { t: T }>;
  }
  private enter() {
    this.depth++;
    if (this.depth > MAX_PARSER_DEPTH) throw new Error('Expression too deep.');
  }
  private exit() { this.depth--; }

  private parseOr(): Node {
    this.enter();
    let left = this.parseAnd();
    while (this.peek().t === 'op' && (this.peek() as any).v === 'OR') {
      this.next();
      const right = this.parseAnd();
      left = { type: 'binop', op: 'OR', left, right };
    }
    this.exit();
    return left;
  }

  private parseAnd(): Node {
    this.enter();
    let left = this.parseNot();
    while (this.peek().t === 'op' && (this.peek() as any).v === 'AND') {
      this.next();
      const right = this.parseNot();
      left = { type: 'binop', op: 'AND', left, right };
    }
    this.exit();
    return left;
  }

  private parseNot(): Node {
    if (this.peek().t === 'op' && (this.peek() as any).v === 'NOT') {
      this.next();
      const arg = this.parseCmp();
      return { type: 'unop', op: 'NOT', arg };
    }
    return this.parseCmp();
  }

  private parseCmp(): Node {
    this.enter();
    let left = this.parseAdd();
    const tok = this.peek();
    if (tok.t === 'op' && ['==', '!=', '>', '<', '>=', '<='].includes((tok as any).v)) {
      const op = (tok as any).v;
      this.next();
      const right = this.parseAdd();
      left = { type: 'binop', op, left, right };
    }
    this.exit();
    return left;
  }

  private parseAdd(): Node {
    this.enter();
    let left = this.parseMul();
    while (this.peek().t === 'op' && ['+', '-'].includes((this.peek() as any).v)) {
      const op = (this.peek() as any).v;
      this.next();
      const right = this.parseMul();
      left = { type: 'binop', op, left, right };
    }
    this.exit();
    return left;
  }

  private parseMul(): Node {
    this.enter();
    let left = this.parsePrimary();
    while (this.peek().t === 'op' && ['*', '/'].includes((this.peek() as any).v)) {
      const op = (this.peek() as any).v;
      this.next();
      const right = this.parsePrimary();
      left = { type: 'binop', op, left, right };
    }
    this.exit();
    return left;
  }

  private parsePrimary(): Node {
    const tok = this.peek();

    if (tok.t === 'num')  { this.next(); return { type: 'literal', value: (tok as any).v }; }
    if (tok.t === 'str')  { this.next(); return { type: 'literal', value: (tok as any).v }; }
    if (tok.t === 'bool') { this.next(); return { type: 'literal', value: (tok as any).v }; }
    if (tok.t === 'null') { this.next(); return { type: 'literal', value: null }; }

    if (tok.t === 'lparen') {
      this.next();
      const inner = this.parseOr();
      this.expect('rparen');
      return inner;
    }

    if (tok.t === 'ident') {
      // Field reference, possibly with .length or .every/.some
      const path: string[] = [(tok as any).v];
      this.next();
      while (this.peek().t === 'dot') {
        this.next();
        const next = this.peek();
        if (next.t !== 'ident') throw new Error('Expected identifier after dot.');

        // Check for array methods
        const ident = (next as any).v;
        const lookahead = this.tokens[this.pos + 1];
        if (lookahead && lookahead.t === 'lparen' && (ident === 'every' || ident === 'some')) {
          // Array method call
          this.next(); // consume identifier
          this.next(); // consume lparen
          const paramTok = this.expect('ident');
          this.expect('arrow');
          const body = this.parseOr();
          this.expect('rparen');
          return {
            type: 'array_method',
            method: ident as 'every' | 'some',
            target: { type: 'field', path },
            param: paramTok.v,
            body,
          };
        }

        if (ident === 'length' && (lookahead?.t !== 'lparen')) {
          this.next(); // consume 'length'
          return { type: 'array_length', target: { type: 'field', path } };
        }

        // Plain nested field
        path.push(ident);
        this.next();
      }
      return { type: 'field', path };
    }

    throw new Error(`Unexpected token ${tok.t}.`);
  }
}

// ============================================================================
// EVALUATOR
// ============================================================================

interface Scope {
  data: Record<string, unknown>;
  /** Lambda parameter bindings */
  bindings?: Record<string, unknown>;
}

function getField(scope: Scope, path: string[]): unknown {
  // Check lambda bindings first
  if (scope.bindings && path.length > 0 && path[0]! in scope.bindings) {
    let cur: unknown = scope.bindings[path[0]!];
    for (let i = 1; i < path.length; i++) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = (cur as Record<string, unknown>)[path[i]!];
    }
    return cur ?? null;
  }
  // Otherwise from data
  let cur: unknown = scope.data;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur ?? null;
}

function evalNode(node: Node, scope: Scope): unknown {
  switch (node.type) {
    case 'literal': return node.value;
    case 'field': return getField(scope, node.path);
    case 'array_length': {
      const arr = evalNode(node.target, scope);
      return Array.isArray(arr) ? arr.length : 0;
    }
    case 'array_method': {
      const arr = evalNode(node.target, scope);
      if (!Array.isArray(arr)) return node.method === 'every'; // empty array → vacuously true
      const fn = (item: unknown) => {
        const inner: Scope = {
          data: scope.data,
          bindings: { ...(scope.bindings ?? {}), [node.param]: item },
        };
        return Boolean(evalNode(node.body, inner));
      };
      return node.method === 'every' ? arr.every(fn) : arr.some(fn);
    }
    case 'unop': {
      const v = evalNode(node.arg, scope);
      if (node.op === 'NOT') return !v;
      throw new Error(`Unknown unary operator ${node.op}.`);
    }
    case 'binop': {
      const l = evalNode(node.left, scope);
      const r = evalNode(node.right, scope);
      switch (node.op) {
        case '==': return looseEq(l, r);
        case '!=': return !looseEq(l, r);
        case '>':  return cmp(l, r) > 0;
        case '<':  return cmp(l, r) < 0;
        case '>=': return cmp(l, r) >= 0;
        case '<=': return cmp(l, r) <= 0;
        case 'AND': return Boolean(l) && Boolean(r);
        case 'OR':  return Boolean(l) || Boolean(r);
        case '+': return Number(l) + Number(r);
        case '-': return Number(l) - Number(r);
        case '*': return Number(l) * Number(r);
        case '/': return Number(l) / Number(r);
      }
      throw new Error(`Unknown binary operator ${node.op}.`);
    }
  }
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Numeric comparison if either side is a number
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  // ISO date strings sort lexically the same as chronologically
  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return Number(a) - Number(b);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/** Maximum nested depth of the parsed AST. Used to reject pathological rules. */
function astDepth(node: Node): number {
  switch (node.type) {
    case 'literal':
    case 'field':
      return 1;
    case 'unop':
      return 1 + astDepth(node.arg);
    case 'binop':
      return 1 + Math.max(astDepth(node.left), astDepth(node.right));
    case 'array_length':
      return 1 + astDepth(node.target);
    case 'array_method':
      return 1 + Math.max(astDepth(node.target), astDepth(node.body));
  }
}

/**
 * Compile a rule string to a function. Compiled once per rule, executed many times.
 * Throws on parse error.
 */
export function compileRule(rule: string): (data: Record<string, unknown>) => boolean {
  const tokens = tokenize(rule);
  const ast = new Parser(tokens).parse();
  if (astDepth(ast) > MAX_AST_DEPTH) {
    throw new Error('Expression too deep.');
  }
  return (data) => Boolean(evalNode(ast, { data }));
}

/** Convenience: parse + execute in one shot. Avoid for hot paths. */
export function evalRule(rule: string, data: Record<string, unknown>): boolean {
  return compileRule(rule)(data);
}
