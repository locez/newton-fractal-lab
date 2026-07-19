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

function splitNumberForWgsl(value) {
  const high = Math.fround(value);
  return [numberForWgsl(high), numberForWgsl(value - high)];
}

function emitDsReal(value) {
  const [high, low] = splitNumberForWgsl(value);
  return `ds_real(${high}, ${low})`;
}

function emitDsConstant(name, constants) {
  const index = constants.indexOf(name);
  const component = ["x", "y", "z", "w"][index % 4];
  const slot = Math.floor(index / 4);
  return `ds_real(uniforms.constants[${slot}].${component}, uniforms.constantLow[${slot}].${component})`;
}

function emitDsWgsl(node, constants, mode = "value") {
  if (node.type === "number") return mode === "value" ? emitDsReal(node.value) : "ds_real(0.0, 0.0)";
  if (node.type === "variable") return mode === "value" ? "z" : "ds_real(1.0, 0.0)";
  if (node.type === "constant") {
    if (node.name === "pi") return mode === "value" ? emitDsReal(Math.PI) : "ds_real(0.0, 0.0)";
    if (node.name === "e") return mode === "value" ? emitDsReal(Math.E) : "ds_real(0.0, 0.0)";
    return mode === "value" ? emitDsConstant(node.name, constants) : "ds_real(0.0, 0.0)";
  }
  if (node.type === "unary") {
    return mode === "value"
      ? `ds_neg(${emitDsWgsl(node.argument, constants, "value")})`
      : `ds_neg(${emitDsWgsl(node.argument, constants, "derivative")})`;
  }
  if (node.type === "binary") {
    const left = emitDsWgsl(node.left, constants, "value");
    const right = emitDsWgsl(node.right, constants, "value");
    const leftDerivative = emitDsWgsl(node.left, constants, "derivative");
    const rightDerivative = emitDsWgsl(node.right, constants, "derivative");
    if (mode === "value") {
      const fn = { "+": "ds_add", "-": "ds_sub", "*": "ds_mul", "/": "ds_div", "^": "ds_pow" }[node.operator];
      return `${fn}(${left}, ${right})`;
    }
    if (node.operator === "+") return `ds_add(${leftDerivative}, ${rightDerivative})`;
    if (node.operator === "-") return `ds_sub(${leftDerivative}, ${rightDerivative})`;
    if (node.operator === "*") return `ds_add(ds_mul(${leftDerivative}, ${right}), ds_mul(${left}, ${rightDerivative}))`;
    if (node.operator === "/") {
      return `ds_div(ds_sub(ds_mul(${leftDerivative}, ${right}), ds_mul(${left}, ${rightDerivative})), ds_mul(${right}, ${right}))`;
    }
    return `ds_mul(ds_pow(${left}, ${right}), ds_add(ds_mul(${rightDerivative}, ds_log(${left})), ds_mul(${right}, ds_div(${leftDerivative}, ${left}))))`;
  }
  if (node.type === "call") {
    const argument = emitDsWgsl(node.argument, constants, "value");
    const derivative = emitDsWgsl(node.argument, constants, "derivative");
    const functionName = {
      sin: "ds_sin",
      cos: "ds_cos",
      tan: "ds_tan",
      ln: "ds_log",
      log: "ds_log",
      exp: "ds_exp",
      sqrt: "ds_sqrt",
      abs: "ds_abs",
    }[node.name];
    if (mode === "value") return `${functionName}(${argument})`;
    if (node.name === "sin") return `ds_mul(ds_cos(${argument}), ${derivative})`;
    if (node.name === "cos") return `ds_mul(ds_neg(ds_sin(${argument})), ${derivative})`;
    if (node.name === "tan") return `ds_mul(ds_div(ds_real(1.0, 0.0), ds_mul(ds_cos(${argument}), ds_cos(${argument}))), ${derivative})`;
    if (node.name === "ln" || node.name === "log") return `ds_mul(ds_div(ds_real(1.0, 0.0), ${argument}), ${derivative})`;
    if (node.name === "exp") return `ds_mul(ds_exp(${argument}), ${derivative})`;
    if (node.name === "sqrt") return `ds_mul(ds_div(ds_real(0.5, 0.0), ds_sqrt(${argument})), ${derivative})`;
    return "ds_real(0.0, 0.0)";
  }
  return "ds_real(0.0, 0.0)";
}

function emitScaledReal(value) {
  return `sc_real(${numberForWgsl(value)})`;
}

function emitScaledConstant(name, constants) {
  if (name === "pi") return emitScaledReal(Math.PI);
  if (name === "e") return emitScaledReal(Math.E);
  const index = constants.indexOf(name);
  const component = ["x", "y", "z", "w"][index % 4];
  const slot = Math.floor(index / 4);
  return `sc_from_ds(ds_real(uniforms.constants[${slot}].${component}, uniforms.constantLow[${slot}].${component}))`;
}

function emitScaledIntegerPower(node, exponent, constants) {
  const base = emitScaledWgsl(node, constants, "value");
  const magnitude = Math.abs(exponent);
  if (!Number.isInteger(exponent) || magnitude > 16) return null;
  if (exponent === 0) return "sc_real(1.0)";
  let result = base;
  for (let index = 1; index < magnitude; index += 1) {
    result = `sc_mul(${result}, ${base})`;
  }
  return exponent > 0 ? result : `sc_div(sc_real(1.0), ${result})`;
}

function emitScaledWgsl(node, constants, mode = "value") {
  if (node.type === "number") return mode === "value" ? emitScaledReal(node.value) : "sc_zero()";
  if (node.type === "variable") return mode === "value" ? "scaledZ" : "sc_real(1.0)";
  if (node.type === "constant") return mode === "value" ? emitScaledConstant(node.name, constants) : "sc_zero()";
  if (node.type === "unary") {
    return mode === "value"
      ? `sc_neg(${emitScaledWgsl(node.argument, constants, "value")})`
      : `sc_neg(${emitScaledWgsl(node.argument, constants, "derivative")})`;
  }
  if (node.type === "binary") {
    const left = emitScaledWgsl(node.left, constants, "value");
    const right = emitScaledWgsl(node.right, constants, "value");
    const leftDerivative = emitScaledWgsl(node.left, constants, "derivative");
    const rightDerivative = emitScaledWgsl(node.right, constants, "derivative");
    if (mode === "value") {
      if (node.operator === "^" && node.right.type === "number") {
        const integerPower = emitScaledIntegerPower(node.left, node.right.value, constants);
        if (integerPower) return integerPower;
      }
      const fn = { "+": "sc_add", "-": "sc_sub", "*": "sc_mul", "/": "sc_div", "^": "sc_pow" }[node.operator];
      return `${fn}(${left}, ${right})`;
    }
    if (node.operator === "+") return rightDerivative === "sc_zero()" ? leftDerivative : `sc_add(${leftDerivative}, ${rightDerivative})`;
    if (node.operator === "-") return rightDerivative === "sc_zero()" ? leftDerivative : `sc_sub(${leftDerivative}, ${rightDerivative})`;
    if (node.operator === "*") return `sc_add(sc_mul(${leftDerivative}, ${right}), sc_mul(${left}, ${rightDerivative}))`;
    if (node.operator === "/") {
      return `sc_div(sc_sub(sc_mul(${leftDerivative}, ${right}), sc_mul(${left}, ${rightDerivative})), sc_mul(${right}, ${right}))`;
    }
    if (node.right.type === "number") {
      const exponent = node.right.value;
      const reducedPower = emitScaledIntegerPower(node.left, exponent - 1, constants);
      if (reducedPower) {
        const factor = `sc_mul(sc_real(${numberForWgsl(exponent)}), ${reducedPower})`;
        return leftDerivative === "sc_real(1.0)" ? factor : `sc_mul(${factor}, ${leftDerivative})`;
      }
    }
    return `sc_mul(sc_pow(${left}, ${right}), sc_add(sc_mul(${rightDerivative}, sc_log(${left})), sc_mul(${right}, sc_div(${leftDerivative}, ${left}))))`;
  }
  if (node.type === "call") {
    const argument = emitScaledWgsl(node.argument, constants, "value");
    const derivative = emitScaledWgsl(node.argument, constants, "derivative");
    const functionName = {
      sin: "sc_sin",
      cos: "sc_cos",
      tan: "sc_tan",
      ln: "sc_log",
      log: "sc_log",
      exp: "sc_exp",
      sqrt: "sc_sqrt",
      abs: "sc_abs",
    }[node.name];
    if (mode === "value") return `${functionName}(${argument})`;
    if (node.name === "sin") return `sc_mul(sc_cos(${argument}), ${derivative})`;
    if (node.name === "cos") return `sc_mul(sc_neg(sc_sin(${argument})), ${derivative})`;
    if (node.name === "tan") return `sc_mul(sc_div(sc_real(1.0), sc_mul(sc_cos(${argument}), sc_cos(${argument}))), ${derivative})`;
    if (node.name === "ln" || node.name === "log") return `sc_mul(sc_div(sc_real(1.0), ${argument}), ${derivative})`;
    if (node.name === "exp") return `sc_mul(sc_exp(${argument}), ${derivative})`;
    if (node.name === "sqrt") return `sc_mul(sc_div(sc_real(0.5), sc_sqrt(${argument})), ${derivative})`;
    return "sc_zero()";
  }
  return "sc_zero()";
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

export function toDsWgsl(ast, constants = []) {
  return {
    value: emitDsWgsl(ast, constants, "value"),
    derivative: emitDsWgsl(ast, constants, "derivative"),
  };
}

export function toScaledWgsl(ast, constants = []) {
  return {
    value: emitScaledWgsl(ast, constants, "value"),
    derivative: emitScaledWgsl(ast, constants, "derivative"),
  };
}
