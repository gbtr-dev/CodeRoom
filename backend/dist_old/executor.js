"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shutdownPool = shutdownPool;
exports.initContainerPool = initContainerPool;
exports.executeCode = executeCode;
exports.formatCode = formatCode;
const child_process_1 = require("child_process");
const prettier_1 = require("prettier");
(function assertDockerTls() {
    const host = process.env.DOCKER_HOST ?? '';
    if (host.startsWith('tcp://') && process.env.DOCKER_TLS_VERIFY !== '1') {
        throw new Error(`DOCKER_HOST points to a TCP address (${host}) but DOCKER_TLS_VERIFY is not '1'. ` +
            'Set DOCKER_TLS_VERIFY=1 and DOCKER_CERT_PATH, or use a Unix socket instead.');
    }
})();
const INTERP_TIMEOUT = 15000;
const COMPILE_TIMEOUT = 60000;
const MAX_OUTPUT = 100000;
const LANG_CONFIGS = {
    js: { image: 'node:22-alpine', filename: 'index.js', runCmd: f => `node ${f}` },
    jsx: { image: 'node:22-alpine', filename: 'index.jsx', runCmd: f => `node ${f}` },
    ts: { image: 'node:22-alpine', filename: 'index.ts', runCmd: f => `node --experimental-strip-types ${f}` },
    tsx: { image: 'node:22-alpine', filename: 'index.tsx', runCmd: f => `node --experimental-strip-types ${f}` },
    py: { image: 'python:3.12-alpine', filename: 'main.py', runCmd: f => `python ${f}` },
    go: { image: 'golang:1.23-alpine', filename: 'main.go', runCmd: _ => `cd /tmp && go run main.go`, extraEnv: ['GOPATH=/tmp/go', 'GOCACHE=/tmp/cache', 'HOME=/tmp'], timeoutMs: COMPILE_TIMEOUT },
    java: { image: 'openjdk:21-slim', filename: 'Main.java', runCmd: f => `java ${f}`, timeoutMs: COMPILE_TIMEOUT },
    kotlin: { image: 'zenika/kotlin:latest', filename: 'Main.kt', runCmd: f => `kotlinc ${f} -include-runtime -d /tmp/main.jar 2>/dev/null && java -jar /tmp/main.jar`, timeoutMs: COMPILE_TIMEOUT },
    c: { image: 'gcc:latest', filename: 'main.c', runCmd: f => `gcc -o /tmp/out ${f} && /tmp/out`, timeoutMs: COMPILE_TIMEOUT },
    cpp: { image: 'gcc:latest', filename: 'main.cpp', runCmd: f => `g++ -o /tmp/out ${f} && /tmp/out`, timeoutMs: COMPILE_TIMEOUT },
    rust: { image: 'rust:alpine', filename: 'main.rs', runCmd: f => `rustc -o /tmp/out ${f} && /tmp/out`, extraEnv: ['CARGO_HOME=/tmp/cargo'], timeoutMs: COMPILE_TIMEOUT },
    csharp: { image: 'mono:latest', filename: 'Program.cs', runCmd: f => `mcs -out:/tmp/prog.exe ${f} && mono /tmp/prog.exe`, timeoutMs: COMPILE_TIMEOUT },
    swift: { image: 'swift:slim', filename: 'main.swift', runCmd: f => `swift ${f}`, extraEnv: ['HOME=/tmp'], timeoutMs: COMPILE_TIMEOUT },
    ruby: { image: 'ruby:3.3-alpine', filename: 'main.rb', runCmd: f => `ruby ${f}` },
    php: { image: 'php:8.3-cli-alpine', filename: 'main.php', runCmd: f => `php ${f}` },
    perl: { image: 'perl:slim', filename: 'main.pl', runCmd: f => `perl ${f}` },
    lua: { image: 'nickblah/lua:5.4', filename: 'main.lua', runCmd: f => `lua ${f}` },
    r: { image: 'r-base:latest', filename: 'main.R', runCmd: f => `Rscript ${f}` },
    shell: { image: 'alpine:3.20', filename: 'script.sh', runCmd: f => `sh ${f}` },
};
// Code is passed via the CODEROOM_CODE env var (set with docker -e) so it
// never touches shell quoting. stdin remains free for user input.
function buildShCmd(config) {
    const f = `/tmp/${config.filename}`;
    const decode = `printf '%s' "$CODEROOM_CODE" | base64 -d > ${f}`;
    return `${decode} && ${config.runCmd(f)}`;
}
// ── Warm container pool ───────────────────────────────────────────────────────
// Only pre-warm interpreted languages — compiled ones have long run times
// anyway so the container startup overhead is negligible by comparison.
const WARM_LANGUAGES = ['js', 'jsx', 'ts', 'tsx', 'py', 'ruby', 'php', 'perl', 'lua', 'shell'];
const POOL_SIZE = 2;
const pool = new Map();
function dockerCmd(args) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)('docker', args, { env: { ...process.env } });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim())));
        child.on('error', reject);
    });
}
const POOL_LABEL = 'coderoom.role=pool';
async function spawnWarmContainer(language) {
    const config = LANG_CONFIGS[language];
    if (!config)
        return null;
    const envFlags = [];
    for (const e of config.extraEnv ?? [])
        envFlags.push('-e', e);
    try {
        const id = await dockerCmd([
            'run', '-d', '--rm',
            '--label', POOL_LABEL,
            '--network', 'none',
            '--memory', '256m',
            '--memory-swap', '256m',
            '--cpus', '0.5',
            '--read-only',
            '--tmpfs', '/tmp:size=256m',
            '--stop-timeout', '5',
            ...envFlags,
            config.image,
            'sleep', 'infinity',
        ]);
        return id;
    }
    catch {
        return null;
    }
}
async function killStalePoolContainers() {
    try {
        const ids = await dockerCmd(['ps', '-q', '--filter', `label=${POOL_LABEL}`]);
        if (!ids)
            return;
        const list = ids.split('\n').filter(Boolean);
        if (list.length > 0)
            await dockerCmd(['kill', ...list]).catch(() => { });
    }
    catch {
        // Non fatale
    }
}
async function shutdownPool() {
    const allIds = Array.from(pool.values()).flat();
    pool.clear();
    if (allIds.length > 0) {
        await dockerCmd(['kill', ...allIds]).catch(() => { });
    }
}
const filling = new Set();
async function fillPool(language) {
    if (filling.has(language))
        return;
    filling.add(language);
    try {
        const current = pool.get(language) ?? [];
        const needed = POOL_SIZE - current.length;
        if (needed <= 0)
            return;
        const ids = await Promise.all(Array.from({ length: needed }, () => spawnWarmContainer(language)));
        const valid = ids.filter((id) => id !== null);
        const nowCurrent = pool.get(language) ?? [];
        pool.set(language, [...nowCurrent, ...valid]);
    }
    finally {
        filling.delete(language);
    }
}
function killContainer(id) {
    (0, child_process_1.spawn)('docker', ['rm', '-f', id], { env: { ...process.env } }).on('error', () => { });
}
async function acquireContainer(language) {
    const available = pool.get(language) ?? [];
    const id = available.shift() ?? null;
    pool.set(language, available);
    fillPool(language).catch(() => { });
    return id;
}
async function initContainerPool() {
    await killStalePoolContainers();
    await Promise.all(WARM_LANGUAGES.map(lang => fillPool(lang)));
}
// ── Execution ─────────────────────────────────────────────────────────────────
async function executeCode(language, code, stdin) {
    const start = Date.now();
    const config = LANG_CONFIGS[language];
    if (!config) {
        return { output: '', error: `Language "${language}" is not supported for execution.`, exitCode: 1, duration: 0 };
    }
    const codeBase64 = Buffer.from(code).toString('base64');
    const shCmd = buildShCmd(config);
    const timeoutMs = config.timeoutMs ?? INTERP_TIMEOUT;
    const stdinPayload = stdin ?? '';
    if (WARM_LANGUAGES.includes(language)) {
        const containerId = await acquireContainer(language);
        if (containerId) {
            const result = await runProcess('docker', ['exec', '-i', '-e', `CODEROOM_CODE=${codeBase64}`, containerId, 'sh', '-c', shCmd], stdinPayload, start, timeoutMs);
            killContainer(containerId);
            return result;
        }
    }
    // Fallback: cold docker run
    const envFlags = [];
    for (const e of config.extraEnv ?? [])
        envFlags.push('-e', e);
    return runProcess('docker', [
        'run', '--rm', '-i',
        '--network', 'none',
        '--memory', '256m',
        '--memory-swap', '256m',
        '--cpus', '0.5',
        '--read-only',
        '--tmpfs', '/tmp:size=256m',
        '--stop-timeout', '5',
        '-e', `CODEROOM_CODE=${codeBase64}`,
        ...envFlags,
        config.image,
        'sh', '-c', shCmd,
    ], stdinPayload, start, timeoutMs);
}
// ── Formatter ─────────────────────────────────────────────────────────────────
// Prettier parser per linguaggio — usato direttamente nel processo Node.js
const PRETTIER_PARSERS = {
    js: 'babel', jsx: 'babel', ts: 'typescript', tsx: 'typescript',
    css: 'css', html: 'html', json: 'json', md: 'markdown',
};
const DOCKER_FMTS = {
    go: { image: 'golang:1.23-alpine', cmd: 'gofmt' },
    rust: { image: 'rust:alpine', cmd: 'rustfmt --edition 2021' },
};
async function formatCode(language, code) {
    // JS/TS/CSS/HTML/JSON/MD — usa prettier API direttamente nel processo
    const parser = PRETTIER_PARSERS[language];
    if (parser) {
        try {
            const formatted = await (0, prettier_1.format)(code, { parser, printWidth: 100, singleQuote: true, semi: true, tabWidth: 2 });
            return { formatted, error: '' };
        }
        catch (err) {
            return { formatted: code, error: err.message ?? 'Prettier error' };
        }
    }
    // Go / Rust — gofmt e rustfmt sono già nell'immagine, nessun download
    const dockerFmt = DOCKER_FMTS[language];
    if (dockerFmt) {
        const result = await runProcess('docker', [
            'run', '--rm', '-i',
            '--network', 'none',
            '--memory', '128m',
            '--memory-swap', '128m',
            '--cpus', '0.5',
            '--read-only',
            '--tmpfs', '/tmp:size=64m',
            '--stop-timeout', '5',
            dockerFmt.image,
            'sh', '-c', dockerFmt.cmd,
        ], code, Date.now(), 15000);
        if (result.exitCode !== 0)
            return { formatted: code, error: result.error };
        return { formatted: result.output, error: '' };
    }
    return { formatted: code, error: '' };
}
function runProcess(cmd, args, stdin, start, timeoutMs) {
    return new Promise((resolve) => {
        let output = '';
        let error = '';
        let finished = false;
        const child = (0, child_process_1.spawn)(cmd, args, { env: { ...process.env } });
        const finish = (code) => {
            if (finished)
                return;
            finished = true;
            resolve({
                output: output.slice(0, MAX_OUTPUT).trim(),
                error: error.slice(0, MAX_OUTPUT).trim(),
                exitCode: code,
                duration: Date.now() - start,
            });
        };
        child.stdin.write(stdin, 'utf8');
        child.stdin.end();
        child.stdout.on('data', (chunk) => { if (output.length < MAX_OUTPUT)
            output += chunk.toString(); });
        child.stderr.on('data', (chunk) => { if (error.length < MAX_OUTPUT)
            error += chunk.toString(); });
        child.on('close', (code) => finish(code ?? 1));
        child.on('error', (err) => {
            error = err.code === 'ENOENT'
                ? 'Docker non trovato. Assicurati che Docker sia installato e in esecuzione.'
                : err.message;
            finish(1);
        });
        setTimeout(() => {
            if (!finished) {
                child.kill('SIGKILL');
                error += '\nExecution timed out.';
                finish(1);
            }
        }, timeoutMs);
    });
}
