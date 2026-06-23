// Syntax-highlighting engine — linguaggi, tokenizer, cache per riga.
// Zero dipendenze da React: importabile anche in worker o test Node.

export type Lang =
  | "js" | "jsx" | "ts" | "tsx"
  | "py" | "r" | "ruby" | "perl"
  | "java" | "c" | "cpp" | "csharp" | "rust" | "go" | "swift" | "kotlin"
  | "html" | "css" | "xml"
  | "sql" | "json" | "yaml" | "toml" | "env" | "md"
  | "shell" | "dockerfile" | "lua" | "php"

export type FileNode = {
  id: string
  name: string
  kind: "file" | "folder"
  parentId: string
  content?: string
  open?: boolean
}

export type RemoteParticipant = {
  id: string
  name: string
  color: string
  fileId?: string
  line?: number
  col?: number
  typing?: boolean
  dbUserId?: string
  dbRole?: "owner" | "editor" | "viewer"
  avatar?: string | null
}

export const LANG_META: Record<Lang, { label: string; dot: string; comment: string | null; keywords: string[] }> = {
  js: {
    label: "JavaScript",
    dot: "#eab308",
    comment: "//",
    keywords: ["import", "from", "export", "default", "const", "let", "var", "async", "await", "function", "return", "if", "else", "for", "while", "new", "class", "extends", "typeof", "of", "in", "true", "false", "null", "undefined", "throw", "delete", "instanceof", "void", "yield", "switch", "case", "break", "continue", "do", "try", "catch", "finally", "debugger"],
  },
  jsx: {
    label: "JSX",
    dot: "#f59e0b",
    comment: "//",
    keywords: ["import", "from", "export", "default", "const", "let", "var", "async", "await", "function", "return", "if", "else", "for", "while", "new", "class", "extends", "typeof", "of", "in", "true", "false", "null", "undefined", "throw", "delete", "instanceof", "void", "yield", "switch", "case", "break", "continue", "do", "try", "catch", "finally", "debugger"],
  },
  py: {
    label: "Python",
    dot: "#3b82f6",
    comment: "#",
    keywords: ["import", "from", "as", "async", "await", "def", "return", "if", "elif", "else", "for", "while", "in", "and", "or", "not", "class", "with", "lambda", "yield", "True", "False", "None", "pass", "raise", "try", "except", "finally", "global", "nonlocal", "del", "assert", "is", "break", "continue", "print", "len", "range", "type", "isinstance", "super", "property", "staticmethod", "classmethod"],
  },
  ts: {
    label: "TypeScript",
    dot: "#007acc",
    comment: "//",
    keywords: ["import", "from", "export", "default", "const", "let", "var", "async", "await", "function", "return", "if", "else", "for", "while", "new", "class", "extends", "typeof", "of", "in", "interface", "type", "enum", "implements", "namespace", "declare", "public", "private", "protected", "readonly", "true", "false", "null", "undefined", "as", "keyof", "infer", "never", "unknown", "any", "abstract", "override", "satisfies", "throw", "switch", "case", "break", "continue", "do", "try", "catch", "finally"],
  },
  tsx: {
    label: "TSX",
    dot: "#2563eb",
    comment: "//",
    keywords: ["import", "from", "export", "default", "const", "let", "var", "async", "await", "function", "return", "if", "else", "for", "while", "new", "class", "extends", "typeof", "of", "in", "interface", "type", "enum", "implements", "namespace", "declare", "public", "private", "protected", "readonly", "true", "false", "null", "undefined", "as", "keyof", "infer", "never", "unknown", "any", "abstract", "override", "satisfies", "throw", "switch", "case", "break", "continue", "do", "try", "catch", "finally"],
  },
  go: {
    label: "Go",
    dot: "#22d3ee",
    comment: "//",
    keywords: ["package", "import", "const", "var", "func", "return", "if", "else", "for", "range", "type", "struct", "interface", "map", "go", "defer", "chan", "select", "switch", "case", "default", "break", "continue", "fallthrough", "goto", "nil", "string", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "float32", "float64", "byte", "rune", "error", "bool", "true", "false", "make", "new", "len", "cap", "append", "copy", "delete", "close", "panic", "recover"],
  },
  java: {
    label: "Java",
    dot: "#f97316",
    comment: "//",
    keywords: ["public", "private", "protected", "static", "final", "class", "interface", "extends", "implements", "abstract", "new", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "void", "int", "long", "double", "float", "boolean", "char", "byte", "short", "String", "import", "package", "this", "super", "true", "false", "null", "throws", "throw", "try", "catch", "finally", "instanceof", "enum", "record", "sealed", "permits", "synchronized", "volatile", "transient", "native"],
  },
  c: {
    label: "C",
    dot: "#60a5fa",
    comment: "//",
    keywords: ["int", "char", "float", "double", "void", "long", "short", "unsigned", "signed", "struct", "enum", "union", "typedef", "const", "static", "extern", "register", "volatile", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "goto", "sizeof", "include", "define", "ifdef", "ifndef", "endif", "pragma", "NULL", "true", "false"],
  },
  cpp: {
    label: "C++",
    dot: "#818cf8",
    comment: "//",
    keywords: ["int", "char", "float", "double", "void", "long", "short", "unsigned", "signed", "struct", "enum", "union", "class", "public", "private", "protected", "template", "typename", "namespace", "using", "const", "constexpr", "consteval", "static", "extern", "inline", "new", "delete", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "goto", "include", "true", "false", "nullptr", "auto", "virtual", "override", "final", "explicit", "friend", "operator", "sizeof", "decltype", "noexcept", "try", "catch", "throw"],
  },
  csharp: {
    label: "C#",
    dot: "#a78bfa",
    comment: "//",
    keywords: ["using", "namespace", "class", "interface", "struct", "enum", "record", "public", "private", "protected", "internal", "static", "readonly", "const", "void", "var", "new", "return", "if", "else", "for", "foreach", "while", "do", "switch", "case", "default", "break", "continue", "true", "false", "null", "async", "await", "get", "set", "init", "this", "base", "abstract", "virtual", "override", "sealed", "partial", "delegate", "event", "is", "as", "typeof", "nameof", "throw", "try", "catch", "finally", "checked", "unchecked", "lock", "out", "ref", "in", "params"],
  },
  rust: {
    label: "Rust",
    dot: "#fb923c",
    comment: "//",
    keywords: ["fn", "let", "mut", "const", "static", "struct", "enum", "impl", "trait", "type", "for", "while", "loop", "if", "else", "match", "return", "break", "continue", "use", "mod", "pub", "crate", "self", "Self", "super", "true", "false", "as", "ref", "where", "async", "await", "move", "dyn", "box", "unsafe", "extern", "macro_rules", "derive", "cfg", "allow", "warn", "deny"],
  },
  ruby: {
    label: "Ruby",
    dot: "#ef4444",
    comment: "#",
    keywords: ["def", "end", "class", "module", "if", "elsif", "else", "unless", "while", "until", "for", "in", "do", "return", "yield", "begin", "rescue", "ensure", "raise", "require", "require_relative", "include", "extend", "prepend", "attr_accessor", "attr_reader", "attr_writer", "true", "false", "nil", "self", "super", "puts", "print", "p", "and", "or", "not", "lambda", "proc", "block_given", "freeze", "frozen", "dup", "clone", "tap", "then"],
  },
  php: {
    label: "PHP",
    dot: "#7c3aed",
    comment: "//",
    keywords: ["function", "return", "if", "elseif", "else", "foreach", "for", "while", "do", "switch", "case", "default", "break", "continue", "class", "interface", "trait", "abstract", "extends", "implements", "public", "private", "protected", "static", "final", "const", "new", "echo", "print", "namespace", "use", "require", "require_once", "include", "include_once", "true", "false", "null", "this", "self", "parent", "array", "list", "match", "fn", "throw", "try", "catch", "finally", "enum", "readonly", "instanceof", "yield"],
  },
  swift: {
    label: "Swift",
    dot: "#ff3b30",
    comment: "//",
    keywords: ["func", "var", "let", "class", "struct", "enum", "protocol", "extension", "if", "else", "guard", "for", "in", "while", "repeat", "switch", "case", "default", "return", "break", "continue", "import", "init", "deinit", "self", "true", "false", "nil", "private", "public", "internal", "fileprivate", "open", "static", "final", "override", "mutating", "lazy", "weak", "unowned", "async", "await", "actor", "throws", "throw", "try", "catch", "rethrows", "some", "any", "inout", "typealias", "associatedtype", "where"],
  },
  kotlin: {
    label: "Kotlin",
    dot: "#c084fc",
    comment: "//",
    keywords: ["fun", "val", "var", "class", "interface", "object", "enum", "data", "sealed", "abstract", "open", "final", "inner", "if", "else", "for", "while", "do", "when", "return", "break", "continue", "import", "package", "this", "super", "true", "false", "null", "private", "public", "protected", "internal", "override", "companion", "is", "in", "as", "by", "init", "constructor", "typealias", "reified", "inline", "infix", "operator", "suspend", "coroutine", "lateinit", "lazy", "const", "crossinline", "noinline"],
  },
  html: {
    label: "HTML",
    dot: "#e34c26",
    comment: null,
    keywords: ["html", "head", "body", "div", "span", "a", "img", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "form", "input", "button", "textarea", "select", "option", "label", "script", "style", "link", "meta", "title", "header", "footer", "nav", "section", "article", "main", "aside", "figure", "figcaption", "picture", "source", "video", "audio", "canvas", "iframe", "template", "slot", "dialog", "details", "summary", "p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "code", "pre", "blockquote", "hr", "br"],
  },
  css: {
    label: "CSS",
    dot: "#264de4",
    comment: null,
    keywords: ["color", "background", "background-color", "background-image", "background-size", "background-position", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "border", "border-radius", "border-color", "border-width", "outline", "display", "flex", "grid", "grid-template-columns", "grid-template-rows", "gap", "flex-direction", "align-items", "justify-content", "flex-wrap", "width", "height", "min-width", "max-width", "min-height", "max-height", "position", "absolute", "relative", "fixed", "sticky", "top", "left", "right", "bottom", "z-index", "overflow", "overflow-x", "overflow-y", "opacity", "transform", "transition", "animation", "content", "cursor", "pointer-events", "font-size", "font-family", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-decoration", "text-transform", "box-shadow", "filter", "clip-path", "none", "auto", "inherit", "initial", "unset", "var", "calc", "important", "media", "keyframes", "root"],
  },
  sql: {
    label: "SQL",
    dot: "#facc15",
    comment: "--",
    keywords: ["SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "ON", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "AS", "AND", "OR", "NOT", "NULL", "IS", "IN", "BETWEEN", "LIKE", "EXISTS", "CASE", "WHEN", "THEN", "ELSE", "END", "UNION", "ALL", "INTERSECT", "EXCEPT", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "CAST", "INDEX", "VIEW", "TRIGGER", "PROCEDURE", "FUNCTION", "RETURNS", "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION"],
  },
  yaml: {
    label: "YAML",
    dot: "#94a3b8",
    comment: "#",
    keywords: ["true", "false", "null", "yes", "no", "on", "off"],
  },
  shell: {
    label: "Shell",
    dot: "#86efac",
    comment: "#",
    keywords: ["if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "case", "esac", "function", "return", "exit", "echo", "printf", "export", "source", "set", "unset", "read", "local", "declare", "typeset", "trap", "exec", "eval", "cd", "ls", "grep", "awk", "sed", "cat", "curl", "wget", "mkdir", "rm", "mv", "cp", "chmod", "chown", "chgrp", "find", "xargs", "sort", "uniq", "cut", "tr", "head", "tail", "wc", "test", "true", "false", "shift", "getopts", "basename", "dirname"],
  },
  toml: {
    label: "TOML",
    dot: "#64748b",
    comment: "#",
    keywords: ["true", "false", "inf", "nan"],
  },
  lua: {
    label: "Lua",
    dot: "#1e3a5f",
    comment: "--",
    keywords: ["function", "return", "if", "then", "elseif", "else", "for", "while", "do", "end", "local", "true", "false", "nil", "and", "or", "not", "break", "repeat", "until", "in", "goto", "require", "pairs", "ipairs", "print", "tostring", "tonumber", "type", "error", "pcall", "xpcall", "setmetatable", "getmetatable", "rawget", "rawset", "select", "unpack", "table", "string", "math", "io", "os"],
  },
  dockerfile: {
    label: "Dockerfile",
    dot: "#38bdf8",
    comment: "#",
    keywords: ["FROM", "RUN", "CMD", "COPY", "ADD", "WORKDIR", "ENV", "EXPOSE", "ENTRYPOINT", "VOLUME", "ARG", "LABEL", "USER", "AS", "SHELL", "HEALTHCHECK", "STOPSIGNAL", "ONBUILD"],
  },
  xml: {
    label: "XML",
    dot: "#f59e0b",
    comment: null,
    keywords: ["xml", "xmlns", "version", "encoding", "standalone", "CDATA", "DOCTYPE", "ELEMENT", "ATTLIST", "ENTITY", "NOTATION", "PUBLIC", "SYSTEM", "xsi", "xsl", "xs"],
  },
  r: {
    label: "R",
    dot: "#16a34a",
    comment: "#",
    keywords: ["function", "return", "if", "else", "for", "while", "repeat", "break", "next", "in", "TRUE", "FALSE", "NULL", "NA", "NA_integer_", "NA_real_", "NA_character_", "NA_complex_", "Inf", "NaN", "library", "require", "source", "print", "cat", "paste", "paste0", "sprintf", "message", "warning", "stop", "tryCatch", "withCallingHandlers", "vector", "list", "data.frame", "matrix", "array", "factor", "c", "length", "nrow", "ncol", "dim", "names", "colnames", "rownames", "which", "apply", "lapply", "sapply", "vapply", "tapply", "Map", "Reduce", "Filter", "sum", "mean", "median", "sd", "var", "min", "max", "range", "table", "subset", "merge", "rbind", "cbind", "head", "tail", "str", "summary", "class", "inherits", "is", "as", "setClass", "setMethod", "new"],
  },
  perl: {
    label: "Perl",
    dot: "#6366f1",
    comment: "#",
    keywords: ["my", "local", "our", "use", "require", "sub", "return", "if", "elsif", "else", "unless", "for", "foreach", "while", "until", "do", "last", "next", "redo", "and", "or", "not", "eq", "ne", "lt", "gt", "le", "ge", "cmp", "print", "say", "die", "warn", "exit", "push", "pop", "shift", "unshift", "splice", "chomp", "chop", "chdir", "chmod", "defined", "undef", "wantarray", "scalar", "ref", "bless", "tie", "untie", "open", "close", "read", "write", "seek", "tell", "eof", "grep", "map", "sort", "reverse", "join", "split", "sprintf", "printf", "pos", "index", "rindex", "substr", "length", "lc", "uc", "ucfirst", "lcfirst"],
  },
  env: {
    label: ".ENV",
    dot: "#4ade80",
    comment: "#",
    keywords: ["export"],
  },
  json: {
    label: "JSON",
    dot: "#10b981",
    comment: null,
    keywords: ["true", "false", "null"],
  },
  md: {
    label: "Markdown",
    dot: "#475569",
    comment: null,
    keywords: ["#", "##", "###", "####", "#####", "######", "**", "__", "_", "*", "`", "```", ">", "---", "***", "- [ ]", "- [x]"],
  },
}

export function getLang(name: string): Lang {
  const lower = name.toLowerCase()
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile"

  const ext = lower.split(".").pop() ?? ""
  if (["js", "mjs", "cjs"].includes(ext)) return "js"
  if (ext === "jsx") return "jsx"
  if (ext === "ts") return "ts"
  if (ext === "tsx") return "tsx"
  if (["py", "pyw"].includes(ext)) return "py"
  if (ext === "go") return "go"
  if (ext === "java") return "java"
  if (["c", "h"].includes(ext)) return "c"
  if (["cpp", "cc", "cxx", "hpp", "hh"].includes(ext)) return "cpp"
  if (ext === "cs") return "csharp"
  if (ext === "rs") return "rust"
  if (ext === "rb") return "ruby"
  if (ext === "php") return "php"
  if (ext === "swift") return "swift"
  if (["kt", "kts"].includes(ext)) return "kotlin"
  if (["html", "htm"].includes(ext)) return "html"
  if (["css", "scss", "sass", "less"].includes(ext)) return "css"
  if (ext === "sql") return "sql"
  if (["yaml", "yml"].includes(ext)) return "yaml"
  if (["sh", "bash", "zsh"].includes(ext)) return "shell"
  if (ext === "toml") return "toml"
  if (ext === "json") return "json"
  if (ext === "lua") return "lua"
  if (ext === "env") return "env"
  if (ext === "xml") return "xml"
  if (ext === "r") return "r"
  if (["md", "markdown"].includes(ext)) return "md"
  if (["pl", "pm"].includes(ext)) return "perl"
  return "md"
}

export function defaultNodes(): FileNode[] {
  return []
}

export const RUN_CMD: Record<Lang, string> = {
  js: "node index.js",
  jsx: "node index.jsx",
  ts: "node index.ts",
  tsx: "npx tsx index.tsx",
  py: "python main.py",
  go: "go run main.go",
  java: "java Main.java",
  c: "gcc main.c -o main && ./main",
  cpp: "g++ main.cpp -o main && ./main",
  csharp: "dotnet run",
  rust: "rustc main.rs -o main && ./main",
  ruby: "ruby main.rb",
  php: "php main.php",
  swift: "swift main.swift",
  kotlin: "kotlinc main.kt -include-runtime -d main.jar && java -jar main.jar",
  shell: "bash script.sh",
  lua: "lua main.lua",
  r: "Rscript main.R",
  perl: "perl main.pl",
  sql: "",
  html: "",
  css: "",
  yaml: "",
  toml: "",
  dockerfile: "",
  json: "",
  md: "",
  xml: "",
  env: "",
}

const C = {
  kw:    "#569cd6", // blue  — control keywords: if, for, return, import…
  kw2:   "#c586c0", // pink  — storage/type keywords: const, let, type, interface…
  kw3:   "#4ec9b0", // teal  — built-in types: string, number, boolean, void…
  fn:    "#dcdcaa", // yellow — function / method names
  str:   "#ce9178", // orange — strings
  tpl:   "#ce9178", // orange — template literal content
  tplEx: "#569cd6", // blue  — ${…} delimiters inside template literals
  num:   "#b5cea8", // green  — numbers
  cm:    "#6a9955", // green  — comments (VSCode uses a slightly different green)
  var:   "#9cdcfe", // light blue — variables / identifiers
  prop:  "#9cdcfe", // light blue — object properties
  cls:   "#4ec9b0", // teal  — class names / types after `new` / type annotations
  rx:    "#d16969", // red   — regex literals
  punc:  "#d4d4d4", // white — punctuation / plain text
  op:    "#d4d4d4", // white — operators
  tag:   "#4ec9b0", // teal  — HTML/JSX tags
  attr:  "#9cdcfe", // blue  — HTML/JSX attributes
  def:   "#d4d4d4", // default text
}

// Keywords split by semantic role (matches VSCode Dark+ token scopes)
const CTRL_KW = new Set([
  "if","else","for","while","do","switch","case","default","break","continue",
  "return","throw","try","catch","finally","yield","await","async","in","of",
  "from","import","export","require","goto","pass","raise","elif","with","as",
  "del","assert","and","or","not","is","lambda","global","nonlocal","select",
  "defer","go","range","fallthrough","foreach","elsif","unless","until","rescue",
  "ensure","begin","end","when","match","guard",
])
const STORAGE_KW = new Set([
  "const","let","var","function","class","interface","type","enum","struct",
  "impl","trait","fn","def","val","module","namespace","declare","abstract",
  "override","extends","implements","new","delete","typeof","instanceof","void",
  "keyof","infer","satisfies","readonly","static","final","sealed","partial",
  "public","private","protected","internal","package","use","mod","crate",
  "super","self","this","Self","companion","object","data","record","sealed",
  "inline","reified","operator","suspend","actor","coroutine","fileprivate","open",
  "mutating","lazy","weak","unowned","actor","noinline","crossinline",
])
const TYPE_KW = new Set([
  "string","number","boolean","bool","int","float","double","long","short",
  "byte","char","rune","uint","usize","isize","i8","i16","i32","i64","u8",
  "u16","u32","u64","f32","f64","never","unknown","any","null","undefined",
  "true","false","nil","None","True","False","NULL","nullptr","NaN","Infinity",
  "void","auto","dynamic",
])

/* ------------------------------------------------------------------ */
/* Syntax highlighter                                                  */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function span(color: string, text: string) {
  return `<span style="color:${color}">${escapeHtml(text)}</span>`
}

// Multiline comment state passed between lines
type HlState = { inBlock: boolean; blockEnd: string }

function highlightLine(line: string, lang: Lang, state: HlState): { html: string; state: HlState } {
  const meta = LANG_META[lang]
  const commentLine = meta.comment

  // --- HTML / XML / JSX tag soup ---
  if (lang === "html" || lang === "xml") {
    let out = ""
    let rest = line
    while (rest.length) {
      const tagOpen = rest.indexOf("<")
      if (tagOpen === -1) { out += span(C.def, rest); break }
      if (tagOpen > 0) { out += span(C.def, rest.slice(0, tagOpen)); rest = rest.slice(tagOpen) }
      // comment
      if (rest.startsWith("<!--")) {
        const end = rest.indexOf("-->")
        if (end === -1) { out += span(C.cm, rest); rest = ""; break }
        out += span(C.cm, rest.slice(0, end + 3)); rest = rest.slice(end + 3); continue
      }
      const tagEnd = rest.indexOf(">")
      const chunk = tagEnd === -1 ? rest : rest.slice(0, tagEnd + 1)
      // tag name
      const tagMatch = chunk.match(/^<\/?([A-Za-z][A-Za-z0-9.-]*)/)
      if (tagMatch) {
        out += span(C.punc, chunk[0] === "<" && chunk[1] === "/" ? "</" : "<")
        out += span(C.tag, tagMatch[1])
        const afterTag = chunk.slice(tagMatch[0].length)
        // attributes
        out += afterTag.replace(/([A-Za-z][\w-]*)(\s*=\s*)(["'][^"']*["'])?/g, (_, a, eq, v) =>
          span(C.attr, a) + span(C.punc, eq) + (v ? span(C.str, v) : ""))
          .replace(/>$/, span(C.punc, ">"))
      } else {
        out += span(C.punc, chunk)
      }
      rest = tagEnd === -1 ? "" : rest.slice(tagEnd + 1)
    }
    return { html: out || "&nbsp;", state }
  }

  // --- CSS ---
  if (lang === "css") {
    const out = line
      .replace(/(&amp;|&lt;|&gt;|[^<>&])+/g, (m) => m) // already escaped below
    let html = ""
    const raw = line
    // simple: selectors, props, values, comments
    if (/^\s*\/\*/.test(raw)) return { html: span(C.cm, raw) || "&nbsp;", state }
    if (/^\s*[\w-.#:[\]()>~+*]+\s*\{?$/.test(raw)) return { html: span(C.fn, raw) || "&nbsp;", state }
    const propMatch = raw.match(/^(\s*)([\w-]+)(\s*:\s*)(.*)$/)
    if (propMatch) {
      html = escapeHtml(propMatch[1]) +
        span(C.attr, propMatch[2]) +
        span(C.punc, propMatch[3]) +
        span(C.str, propMatch[4])
      return { html: html || "&nbsp;", state }
    }
    return { html: span(C.def, raw) || "&nbsp;", state }
  }

  // --- JSON ---
  if (lang === "json") {
    let out = ""
    let i = 0
    const s = line
    while (i < s.length) {
      const ch = s[i]
      if (ch === '"') {
        let j = i + 1
        while (j < s.length && s[j] !== '"') { if (s[j] === "\\") j++; j++ }
        const str = s.slice(i, j + 1)
        // key or value? look at what follows
        const after = s.slice(j + 1).trimStart()
        out += span(after.startsWith(":") ? C.var : C.str, str)
        i = j + 1; continue
      }
      if (/\d/.test(ch) || (ch === "-" && /\d/.test(s[i+1] ?? ""))) {
        const m = s.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)!
        out += span(C.num, m[0]); i += m[0].length; continue
      }
      if (s.slice(i).startsWith("true") || s.slice(i).startsWith("false") || s.slice(i).startsWith("null")) {
        const m = s.slice(i).match(/^(true|false|null)/)!
        out += span(C.kw, m[0]); i += m[0].length; continue
      }
      out += span(C.punc, ch); i++
    }
    return { html: out || "&nbsp;", state }
  }

  // --- Markdown ---
  if (lang === "md") {
    if (/^\s*#{1,6}\s/.test(line)) return { html: span(C.kw, line) || "&nbsp;", state }
    if (/^\s*```/.test(line)) return { html: span(C.cm, line) || "&nbsp;", state }
    if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      return { html: span(C.punc, line.match(/^\s*[-*+\d.]+\s/)![0]) + span(C.def, line.slice(line.match(/^\s*[-*+\d.]+\s/)![0].length)) || "&nbsp;", state }
    }
    if (/^\s*>/.test(line)) return { html: span(C.cm, line) || "&nbsp;", state }
    // inline: **bold**, *italic*, `code`, [link](url)
    const html = line
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/`([^`]+)`/g, `<span style="color:${C.str}">$&</span>`)
      .replace(/\*\*([^*]+)\*\*/g, `<span style="color:${C.fn}">$&</span>`)
      .replace(/\*([^*]+)\*/g, `<span style="color:${C.kw2}">$&</span>`)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<span style="color:${C.var}">[$1]</span><span style="color:${C.str}">($2)</span>`)
    return { html: html || "&nbsp;", state }
  }

  // --- Generic: JS/TS/PY/GO/RUST/etc ---
  // Handle block comment carry-over
  let newState = { ...state }
  let src = line

  if (state.inBlock) {
    const end = src.indexOf(state.blockEnd)
    if (end === -1) return { html: span(C.cm, src) || "&nbsp;", state: newState }
    const html = span(C.cm, src.slice(0, end + state.blockEnd.length))
    newState.inBlock = false
    src = src.slice(end + state.blockEnd.length)
    if (!src.trim()) return { html: html || "&nbsp;", state: newState }
    const rest = highlightLine(src, lang, newState)
    return { html: html + rest.html, state: rest.state }
  }

  let out = ""
  let i = 0

  while (i < src.length) {
    const rest = src.slice(i)
    const ch = src[i]

    // Line comment
    if (commentLine && rest.startsWith(commentLine)) {
      out += span(C.cm, rest); break
    }

    // Block comments /* */ or """ (python docstrings treated as block)
    if (rest.startsWith("/*") || (lang === "py" && (rest.startsWith('"""') || rest.startsWith("'''")))) {
      const blockEnd = rest.startsWith("/*") ? "*/" : rest.slice(0, 3)
      const end = rest.indexOf(blockEnd, blockEnd.length)
      if (end === -1) {
        out += span(C.cm, rest)
        newState.inBlock = true; newState.blockEnd = blockEnd; break
      }
      out += span(C.cm, rest.slice(0, end + blockEnd.length))
      i += end + blockEnd.length; continue
    }

    // Regex literal (JS/TS only) — heuristic: / after operator or start
    if ((lang === "js" || lang === "ts" || lang === "jsx" || lang === "tsx") && ch === "/") {
      const prev = out.replace(/<[^>]+>/g, "").trimEnd().slice(-1)
      if (!prev || /[=(:,[!&|?{};]/.test(prev)) {
        let j = i + 1; let escaped = false
        while (j < src.length && (src[j] !== "/" || escaped)) {
          escaped = !escaped && src[j] === "\\"; j++
        }
        if (j < src.length && j > i + 1) {
          const flags = src.slice(j + 1).match(/^[gimsuy]*/)?.[0] ?? ""
          out += span(C.rx, src.slice(i, j + 1 + flags.length))
          i = j + 1 + flags.length; continue
        }
      }
    }

    // Template literals (backtick)
    if (ch === "`") {
      let j = i + 1; let tpl = "`"; let depth = 0
      while (j < src.length) {
        if (src[j] === "`" && depth === 0) { tpl += "`"; j++; break }
        if (src[j] === "$" && src[j+1] === "{") { tpl += "${"; j += 2; depth++; continue }
        if (src[j] === "}" && depth > 0) { tpl += "}"; j++; depth--; continue }
        tpl += src[j]; j++
      }
      out += `<span style="color:${C.tpl}">${escapeHtml(tpl)}</span>`
      i = j; continue
    }

    // Regular strings
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== ch) { if (src[j] === "\\") j++; j++ }
      out += span(C.str, src.slice(i, Math.min(j + 1, src.length)))
      i = j + 1; continue
    }

    // Numbers
    if (/\d/.test(ch) && !/[A-Za-z_$]/.test(src[i-1] ?? "")) {
      const m = rest.match(/^(0x[\da-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)/)
      if (m) { out += span(C.num, m[0]); i += m[0].length; continue }
    }

    // Identifiers & keywords
    const idM = rest.match(/^[A-Za-z_$][\w$]*/)
    if (idM) {
      const word = idM[0]
      const after = src.slice(i + word.length).trimStart()
      const before = src.slice(0, i).trimEnd().slice(-1)
      let color: string

      if (CTRL_KW.has(word)) color = C.kw
      else if (STORAGE_KW.has(word)) color = C.kw2
      else if (TYPE_KW.has(word)) color = C.kw3
      else if (/^[A-Z]/.test(word)) color = C.cls          // PascalCase → type/class
      else if (/^[\s(<]/.test(after) && after[0] !== "<" || after.startsWith("(")) color = C.fn  // call
      else if (before === ".") color = C.prop               // property access
      else color = C.var

      out += span(color, word); i += word.length; continue
    }

    // Everything else (operators, punctuation)
    out += span(/[{}[\]();,.]/.test(ch) ? C.punc : C.op, ch)
    i++
  }

  return { html: out || "&nbsp;", state: newState }
}

export type HighlightCache = {
  lang: Lang
  lineSrc: string[]
  lineHtml: string[]
  lineStateOut: HlState[]
}

function sameState(a: HlState | undefined, b: HlState): boolean {
  return !!a && a.inBlock === b.inBlock && a.blockEnd === b.blockEnd
}

// Riusa l'highlight delle righe non toccate da una modifica invece di
// ritokenizzare l'intero file ad ogni keystroke. Una riga viene ricalcolata
// solo se il suo testo è cambiato oppure se lo stato (es. commento multilinea)
// con cui la riga viene "raggiunta" è diverso da quello dell'ultima esecuzione:
// in entrambi i casi il risultato resta identico a una ricostruzione completa,
// solo più rapido perché evita lavoro su righe identiche e invariate.
export function highlightCode(code: string, lang: Lang, cache?: HighlightCache): { html: string; cache: HighlightCache } {
  const lines = code.split("\n")
  const prev = cache && cache.lang === lang ? cache : undefined

  const lineHtml: string[] = new Array(lines.length)
  const lineStateOut: HlState[] = new Array(lines.length)
  let state: HlState = { inBlock: false, blockEnd: "" }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const prevStateIn = idx === 0 ? { inBlock: false, blockEnd: "" } : prev?.lineStateOut[idx - 1]
    const canReuse =
      prev !== undefined &&
      prev.lineSrc[idx] === line &&
      prev.lineHtml[idx] !== undefined &&
      sameState(prevStateIn, state)

    if (canReuse) {
      lineHtml[idx] = prev!.lineHtml[idx]
      lineStateOut[idx] = prev!.lineStateOut[idx]
      state = lineStateOut[idx]
      continue
    }

    const result = highlightLine(line, lang, state)
    lineHtml[idx] = result.html
    lineStateOut[idx] = result.state
    state = result.state
  }

  return {
    html: lineHtml.join("\n"),
    cache: { lang, lineSrc: lines, lineHtml, lineStateOut },
  }
}