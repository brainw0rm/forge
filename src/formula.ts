// A tiny, safe formula language for the gear sandbox. No eval: expressions are parsed
// into a tree and evaluated against named numbers.
//
//   sheet:       one "name = expression" per line; "#" starts a comment
//   expression:  numbers, names, + - * /, parentheses, and min/max/floor/ceil/round/abs

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

type Node =
  | { k: "num"; v: number }
  | { k: "var"; v: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
};

export class FormulaError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new FormulaError(`Bad number near “${src.slice(i, i + 6)}”`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else if ("+-*/(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new FormulaError(`Unexpected “${c}”`);
    }
  }
  return out;
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v: string) => {
    const t = toks[p];
    if (!t || t.t !== "op" || t.v !== v) throw new FormulaError(`Expected “${v}”`);
    p++;
  };
  const expr = (): Node => {
    let a = term();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: term() };
    }
    return a;
  };
  const term = (): Node => {
    let a = unary();
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (peek()?.t === "op" && peek()!.v === "-") {
      p++;
      return { k: "neg", a: unary() };
    }
    if (peek()?.t === "op" && peek()!.v === "+") {
      p++;
      return unary();
    }
    return atom();
  };
  const atom = (): Node => {
    const t = toks[p++];
    if (!t) throw new FormulaError("Unexpected end of formula");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "id") {
      if (peek()?.t === "op" && peek()!.v === "(") {
        if (!FUNCS[t.v]) throw new FormulaError(`Unknown function “${t.v}”`);
        p++;
        const args: Node[] = [];
        if (!(peek()?.t === "op" && peek()!.v === ")")) {
          args.push(expr());
          while (peek()?.t === "op" && peek()!.v === ",") {
            p++;
            args.push(expr());
          }
        }
        eat(")");
        return { k: "call", fn: t.v, args };
      }
      return { k: "var", v: t.v };
    }
    if (t.v === "(") {
      const e = expr();
      eat(")");
      return e;
    }
    throw new FormulaError(`Unexpected “${t.v}”`);
  };
  const tree = expr();
  if (p < toks.length) throw new FormulaError(`Unexpected “${(toks[p] as { v: unknown }).v}”`);
  return tree;
}

export function evaluate(node: Node, vars: Record<string, number>): number {
  switch (node.k) {
    case "num":
      return node.v;
    case "var":
      if (!(node.v in vars)) throw new FormulaError(`Unknown name “${node.v}”`);
      return vars[node.v];
    case "neg":
      return -evaluate(node.a, vars);
    case "call":
      return FUNCS[node.fn](...node.args.map((a) => evaluate(a, vars)));
    case "bin": {
      const a = evaluate(node.a, vars);
      const b = evaluate(node.b, vars);
      if (node.op === "+") return a + b;
      if (node.op === "-") return a - b;
      if (node.op === "*") return a * b;
      if (b === 0) throw new FormulaError("Division by zero");
      return a / b;
    }
  }
}

export interface SheetLine {
  line: number;
  name?: string;
  source: string;
  value?: number;
  error?: string;
  comment?: string;
}

/** Evaluate a sheet top to bottom; each line can use the inputs and every name defined above it. */
export function runSheet(sheet: string, inputs: Record<string, number>): { lines: SheetLine[]; vars: Record<string, number> } {
  const vars = { ...inputs };
  const lines: SheetLine[] = [];
  sheet.split("\n").forEach((raw, i) => {
    const [code, ...rest] = raw.split("#");
    const comment = rest.length ? rest.join("#").trim() : undefined;
    const text = code.trim();
    if (!text) {
      if (comment !== undefined) lines.push({ line: i + 1, source: "", comment });
      return;
    }
    const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(text);
    if (!m) {
      lines.push({ line: i + 1, source: text, error: "Write lines as “name = formula”", comment });
      return;
    }
    try {
      const value = evaluate(parse(m[2]), vars);
      if (!Number.isFinite(value)) throw new FormulaError("Result isn't a number");
      vars[m[1]] = value;
      lines.push({ line: i + 1, name: m[1], source: m[2], value, comment });
    } catch (err) {
      lines.push({ line: i + 1, name: m[1], source: m[2], error: (err as Error).message, comment });
    }
  });
  return { lines, vars };
}
