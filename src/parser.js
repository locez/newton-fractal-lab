import {
  ONE,
  ZERO,
  cAbs,
  cAdd,
  cCos,
  cDiv,
  cExp,
  cLog,
  cMul,
  cNeg,
  cPow,
  cSin,
  cSqrt,
  cSub,
  cTan,
  complex,
} from "./complex.js";

const FUNCTIONS = new Set(["sin", "cos", "tan", "ln", "log", "exp", "sqrt", "abs"]);
const BUILTIN_CONSTANTS = new Set(["pi", "e"]);
const VARIABLE_NAMES = new Set(["x", "y", "z"]);

export class ExpressionError extends Error {
  constructor(message, position = 0) {
    super(message);
    this.name = "ExpressionError";
    this.position = position;
  }
}

function token(type, value, position) {
  return { type, value, position };
}

function tokenize(source) {
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === "π") {
      tokens.push(token("identifier", "pi", index));
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(character)) {
      const start = index;
      let sawDigit = false;
      while (index < source.length && /[0-9]/.test(source[index])) {
        sawDigit = true;
        index += 1;
      }
      if (source[index] === ".") {
        index += 1;
        while (index < source.length && /[0-9]/.test(source[index])) {
          sawDigit = true;
          index += 1;
        }
      }
      if (!sawDigit) throw new ExpressionError("A number needs at least one digit.", start);
      if (source[index] === "e" || source[index] === "E") {
        const exponentStart = index;
        index += 1;
        if (source[index] === "+" || source[index] === "-") index += 1;
        const digitStart = index;
        while (index < source.length && /[0-9]/.test(source[index])) index += 1;
        if (digitStart === index) throw new ExpressionError("Incomplete scientific notation.", exponentStart);
      }
      const value = Number(source.slice(start, index));
      if (!Number.isFinite(value)) throw new ExpressionError("That number is outside the supported range.", start);
      tokens.push(token("number", value, start));
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) index += 1;
      tokens.push(token("identifier", source.slice(start, index), start));
      continue;
    }

    if ("+-*/^(),".includes(character)) {
      tokens.push(token(character, character, index));
      index += 1;
      continue;
    }

    if (character === "×") {
      tokens.push(token("*", "*", index));
      index += 1;
      continue;
    }
    if (character === "÷") {
      tokens.push(token("/", "/", index));
      index += 1;
      continue;
    }

    throw new ExpressionError(`Unsupported character '${character}'.`, index);
  }

  tokens.push(token("eof", "", source.length));
  return tokens;
}

class Parser {
  constructor(source) {
    this.source = source;
    this.tokens = tokenize(source);
    this.index = 0;
  }

  current() {
    return this.tokens[this.index];
  }

  advance() {
    const current = this.current();
    this.index += 1;
    return current;
  }

  match(type) {
    if (this.current().type !== type) return false;
    this.index += 1;
    return true;
  }

  expect(type, message) {
    if (this.current().type !== type) {
      throw new ExpressionError(message, this.current().position);
    }
    return this.advance();
  }

  parse() {
    if (this.current().type === "eof") throw new ExpressionError("Enter an expression before applying it.", 0);
    const ast = this.parseExpression();
    if (this.current().type !== "eof") {
      throw new ExpressionError(`Unexpected '${this.current().value}'.`, this.current().position);
    }
    return ast;
  }

  parseExpression() {
    let node = this.parseTerm();
    while (this.current().type === "+" || this.current().type === "-") {
      const operator = this.advance().type;
      node = { type: "binary", operator, left: node, right: this.parseTerm() };
    }
    return node;
  }

  parseTerm() {
    let node = this.parseUnary();
    while (true) {
      if (this.current().type === "*" || this.current().type === "/") {
        const operator = this.advance().type;
        node = { type: "binary", operator, left: node, right: this.parseUnary() };
        continue;
      }

      if (this.isPrimaryStart(this.current())) {
        node = { type: "binary", operator: "*", left: node, right: this.parseUnary() };
        continue;
      }
      return node;
    }
  }

  parseUnary() {
    if (this.match("+")) return this.parseUnary();
    if (this.match("-")) return { type: "unary", operator: "-", argument: this.parseUnary() };
    return this.parsePower();
  }

  parsePower() {
    const node = this.parsePrimary();
    if (this.match("^")) return { type: "binary", operator: "^", left: node, right: this.parseUnary() };
    return node;
  }

  parsePrimary() {
    const current = this.current();
    if (current.type === "number") {
      this.advance();
      return { type: "number", value: current.value };
    }

    if (current.type === "identifier") {
      this.advance();
      if (this.match("(")) {
        if (!FUNCTIONS.has(current.value)) {
          throw new ExpressionError(`'${current.value}' is not a supported function.`, current.position);
        }
        const argument = this.parseExpression();
        this.expect(")", "Missing ')' after function argument.");
        return { type: "call", name: current.value, argument };
      }

      if (FUNCTIONS.has(current.value)) {
        throw new ExpressionError(`Function '${current.value}' needs parentheses.`, current.position);
      }
      if (BUILTIN_CONSTANTS.has(current.value)) return { type: "constant", name: current.value, builtin: true };
      if (VARIABLE_NAMES.has(current.value)) return { type: "variable", name: current.value };
      if (/^[A-Za-z]$/.test(current.value)) return { type: "constant", name: current.value, builtin: false };
      throw new ExpressionError(`Unknown symbol '${current.value}'.`, current.position);
    }

    if (this.match("(")) {
      const node = this.parseExpression();
      this.expect(")", "Missing closing ')'.");
      return node;
    }

    if (current.type === "eof") throw new ExpressionError("The expression ends too early.", current.position);
    throw new ExpressionError(`Expected a number, variable, or '('. Found '${current.value}'.`, current.position);
  }

  isPrimaryStart(current) {
    return current.type === "number" || current.type === "identifier" || current.type === "(";
  }
}

function collectSymbols(node, symbols = { variables: [], constants: [] }) {
  if (node.type === "variable" && !symbols.variables.includes(node.name)) symbols.variables.push(node.name);
  if (node.type === "constant" && !node.builtin && !symbols.constants.includes(node.name)) symbols.constants.push(node.name);
  if (node.argument) collectSymbols(node.argument, symbols);
  if (node.left) collectSymbols(node.left, symbols);
  if (node.right) collectSymbols(node.right, symbols);
  return symbols;
}

function constantValue(name, constants = {}) {
  if (name === "pi") return Math.PI;
  if (name === "e") return Math.E;
  return Number.isFinite(Number(constants[name])) ? Number(constants[name]) : 0;
}

function dual(value, derivative = ZERO) {
  return { value, derivative };
}

function evaluateDual(node, z, constants) {
  if (node.type === "number") return dual(complex(node.value, 0));
  if (node.type === "variable") return dual(z, ONE);
  if (node.type === "constant") return dual(complex(constantValue(node.name, constants), 0));
  if (node.type === "unary") {
    const argument = evaluateDual(node.argument, z, constants);
    return dual(cNeg(argument.value), cNeg(argument.derivative));
  }

  if (node.type === "binary") {
    const left = evaluateDual(node.left, z, constants);
    const right = evaluateDual(node.right, z, constants);
    if (node.operator === "+") return dual(cAdd(left.value, right.value), cAdd(left.derivative, right.derivative));
    if (node.operator === "-") return dual(cSub(left.value, right.value), cSub(left.derivative, right.derivative));
    if (node.operator === "*") {
      return dual(
        cMul(left.value, right.value),
        cAdd(cMul(left.derivative, right.value), cMul(left.value, right.derivative)),
      );
    }
    if (node.operator === "/") {
      const denominator = cMul(right.value, right.value);
      return dual(
        cDiv(left.value, right.value),
        cDiv(cSub(cMul(left.derivative, right.value), cMul(left.value, right.derivative)), denominator),
      );
    }
    if (node.operator === "^") {
      const value = cPow(left.value, right.value);
      const logarithm = cLog(left.value);
      const logarithmicDerivative = cAdd(
        cMul(right.derivative, logarithm),
        cMul(right.value, cDiv(left.derivative, left.value)),
      );
      return dual(value, cMul(value, logarithmicDerivative));
    }
  }

  if (node.type === "call") {
    const argument = evaluateDual(node.argument, z, constants);
    const value = node.name === "sin"
      ? cSin(argument.value)
      : node.name === "cos"
        ? cCos(argument.value)
        : node.name === "tan"
          ? cTan(argument.value)
          : node.name === "ln" || node.name === "log"
            ? cLog(argument.value)
            : node.name === "exp"
              ? cExp(argument.value)
              : node.name === "sqrt"
                ? cSqrt(argument.value)
                : complex(cAbs(argument.value), 0);

    let derivativeFactor = ZERO;
    if (node.name === "sin") derivativeFactor = cCos(argument.value);
    if (node.name === "cos") derivativeFactor = cNeg(cSin(argument.value));
    if (node.name === "tan") derivativeFactor = cDiv(ONE, cMul(cCos(argument.value), cCos(argument.value)));
    if (node.name === "ln" || node.name === "log") derivativeFactor = cDiv(ONE, argument.value);
    if (node.name === "exp") derivativeFactor = value;
    if (node.name === "sqrt") derivativeFactor = cDiv(complex(0.5, 0), value);
    return dual(value, cMul(derivativeFactor, argument.derivative));
  }

  return dual(complex(Number.NaN, Number.NaN), complex(Number.NaN, Number.NaN));
}

function numberForWgsl(value) {
  if (!Number.isFinite(value)) return "0.0";
  if (Object.is(value, -0)) return "-0.0";
  const text = Number(value).toString();
  if (!text.includes("e")) return text.includes(".") ? text : `${text}.0`;
  const [mantissa, exponent] = text.split("e");
  return `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}e${exponent}`;
}

function emitWgsl(node, constants, mode = "value") {
  if (node.type === "number") {
    return mode === "value" ? `vec2<f32>(${numberForWgsl(node.value)}, 0.0)` : "vec2<f32>(0.0, 0.0)";
  }
  if (node.type === "variable") return mode === "value" ? "z" : "vec2<f32>(1.0, 0.0)";
  if (node.type === "constant") {
    if (node.name === "pi") return "vec2<f32>(3.14159265359, 0.0)";
    if (node.name === "e") return "vec2<f32>(2.71828182846, 0.0)";
    const index = constants.indexOf(node.name);
    return mode === "value" ? `vec2<f32>(uniforms.constants[${Math.floor(index / 4)}].${["x", "y", "z", "w"][index % 4]}, 0.0)` : "vec2<f32>(0.0, 0.0)";
  }
  if (node.type === "unary") {
    return mode === "value"
      ? `c_neg(${emitWgsl(node.argument, constants, "value")})`
      : `c_neg(${emitWgsl(node.argument, constants, "derivative")})`;
  }
  if (node.type === "binary") {
    const left = emitWgsl(node.left, constants, "value");
    const right = emitWgsl(node.right, constants, "value");
    const leftDerivative = emitWgsl(node.left, constants, "derivative");
    const rightDerivative = emitWgsl(node.right, constants, "derivative");
    if (mode === "value") {
      const fn = { "+": "c_add", "-": "c_sub", "*": "c_mul", "/": "c_div", "^": "c_pow" }[node.operator];
      return `${fn}(${left}, ${right})`;
    }
    if (node.operator === "+") return `c_add(${leftDerivative}, ${rightDerivative})`;
    if (node.operator === "-") return `c_sub(${leftDerivative}, ${rightDerivative})`;
    if (node.operator === "*") return `c_add(c_mul(${leftDerivative}, ${right}), c_mul(${left}, ${rightDerivative}))`;
    if (node.operator === "/") {
      return `c_div(c_sub(c_mul(${leftDerivative}, ${right}), c_mul(${left}, ${rightDerivative})), c_mul(${right}, ${right}))`;
    }
    return `c_mul(c_pow(${left}, ${right}), c_add(c_mul(${rightDerivative}, c_log(${left})), c_mul(${right}, c_div(${leftDerivative}, ${left}))))`;
  }
  if (node.type === "call") {
    const argument = emitWgsl(node.argument, constants, "value");
    const derivative = emitWgsl(node.argument, constants, "derivative");
    const functionName = {
      sin: "c_sin",
      cos: "c_cos",
      tan: "c_tan",
      ln: "c_log",
      log: "c_log",
      exp: "c_exp",
      sqrt: "c_sqrt",
      abs: "c_abs",
    }[node.name];
    if (mode === "value") return `${functionName}(${argument})`;
    if (node.name === "sin") return `c_mul(c_cos(${argument}), ${derivative})`;
    if (node.name === "cos") return `c_mul(c_neg(c_sin(${argument})), ${derivative})`;
    if (node.name === "tan") return `c_mul(c_div(vec2<f32>(1.0, 0.0), c_mul(c_cos(${argument}), c_cos(${argument}))), ${derivative})`;
    if (node.name === "ln" || node.name === "log") return `c_mul(c_div(vec2<f32>(1.0, 0.0), ${argument}), ${derivative})`;
    if (node.name === "exp") return `c_mul(c_exp(${argument}), ${derivative})`;
    if (node.name === "sqrt") return `c_mul(c_div(vec2<f32>(0.5, 0.0), c_sqrt(${argument})), ${derivative})`;
    return "vec2<f32>(0.0, 0.0)";
  }
  return "vec2<f32>(0.0, 0.0)";
}

export function parseExpression(source) {
  const trimmed = String(source || "").trim();
  const ast = new Parser(trimmed).parse();
  const symbols = collectSymbols(ast);
  return {
    ast,
    source: trimmed,
    variables: symbols.variables,
    constants: symbols.constants,
  };
}

export function evaluateExpression(ast, z, constants = {}) {
  return evaluateDual(ast, z, constants);
}

export function toWgsl(ast, constants = []) {
  return {
    value: emitWgsl(ast, constants, "value"),
    derivative: emitWgsl(ast, constants, "derivative"),
  };
}
