/**
 * Local UI server: pick integration tests, run mocha with INCLUDE_CASES, stream logs via SSE.
 * Usage: node test-runner-server.js
 * Env: TEST_RUNNER_PORT (default 9876), TEST_RUNNER_HOST (default 127.0.0.1)
 */
require('dotenv').config();

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, exec } = require('node:child_process');

const glob = require('glob');
const { stripAnsi, ansiToHtml } = require('./lib/test-runner-ansi');

const ROOT = __dirname;
const UI_DIR = path.join(ROOT, 'test-runner-ui');
const PORT = Number(process.env.TEST_RUNNER_PORT) || 9876;
const HOST = process.env.TEST_RUNNER_HOST || '127.0.0.1';

const MAX_FED_TAIL = 512 * 1024;

/** @type {Map<string, { mtimeMs: number, size: number, count: number }>} */
const fedLineCountCache = new Map();

/** @type {import('node:child_process').ChildProcess | null} */
let currentChild = null;
/** @type {NodeJS.Timeout | null} */
let abortKillTimer = null;

/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();

function broadcast(event, payload) {
    const data = JSON.stringify(payload);
    for (const res of sseClients) {
        try {
            res.write(`event: ${event}\ndata: ${data}\n\n`);
        } catch {
            sseClients.delete(res);
        }
    }
}

function resolveLogHome() {
    const h = process.env.LOG_HOME;
    if (!h) {
        return path.join(ROOT, 'logs');
    }
    return path.isAbsolute(h) ? h : path.join(ROOT, h);
}

function safeFedPath(rel) {
    const logHome = path.resolve(resolveLogHome());
    const abs = path.resolve(logHome, rel);
    const normalizedLogHome = logHome.endsWith(path.sep) ? logHome : logHome + path.sep;
    if (abs !== logHome && !abs.startsWith(normalizedLogHome)) {
        throw new Error('Invalid path');
    }
    return abs;
}

/**
 * Line count: number of newline characters, plus one if the file is non-empty and does not end with LF.
 * Empty files return 0.
 * Cached by mtime+size so /api/fed-logs polling does not rescan unchanged files.
 * @param {string} absPath
 * @returns {number}
 */
function countLinesInFile(absPath) {
    const stat = fs.statSync(absPath);
    if (stat.size === 0) {
        fedLineCountCache.delete(absPath);
        return 0;
    }
    const cached = fedLineCountCache.get(absPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.count;
    }
    const fd = fs.openSync(absPath, 'r');
    try {
        const buf = Buffer.alloc(65536);
        let pos = 0;
        let newlineCount = 0;
        let lastByte = 0;
        while (pos < stat.size) {
            const toRead = Math.min(buf.length, stat.size - pos);
            const len = fs.readSync(fd, buf, 0, toRead, pos);
            if (len === 0) {
                break;
            }
            pos += len;
            for (let i = 0; i < len; i++) {
                if (buf[i] === 0x0a) {
                    newlineCount++;
                }
                lastByte = buf[i];
            }
        }
        if (lastByte !== 0x0a) {
            newlineCount++;
        }
        fedLineCountCache.set(absPath, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            count: newlineCount,
        });
        return newlineCount;
    } finally {
        fs.closeSync(fd);
    }
}

function listFedLogs() {
    const root = resolveLogHome();
    const files = [];
    if (!fs.existsSync(root)) {
        return { root, exists: false, files: [] };
    }
    const walk = (dir, relBase) => {
        const names = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of names) {
            const rel = relBase ? path.join(relBase, ent.name) : ent.name;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                walk(full, rel);
            } else if (ent.isFile() && ent.name.endsWith('.log')) {
                const lineCount = countLinesInFile(full);
                if (lineCount === 0) {
                    continue;
                }
                files.push({
                    rel: rel.split(path.sep).join('/'),
                    label: rel.split(path.sep).join(' / '),
                    lineCount,
                });
            }
        }
    };
    walk(root, '');
    files.sort((a, b) => a.rel.localeCompare(b.rel));
    return { root, exists: true, files };
}

function readFedLog(relPath, fromByte) {
    const abs = safeFedPath(relPath);
    if (!fs.existsSync(abs)) {
        return { error: 'File not found' };
    }
    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
        return { error: 'Not a file' };
    }
    const size = stat.size;
    if (fromByte > size) {
        return readFedLog(relPath, 0);
    }
    if (fromByte === 0) {
        const start = Math.max(0, size - MAX_FED_TAIL);
        const len = size - start;
        const buf = Buffer.alloc(len);
        const fd = fs.openSync(abs, 'r');
        try {
            fs.readSync(fd, buf, 0, len, start);
        } finally {
            fs.closeSync(fd);
        }
        return {
            text: buf.toString('utf8'),
            nextOffset: size,
            size,
            truncated: start > 0,
        };
    }
    if (fromByte === size) {
        return { text: '', nextOffset: size, size };
    }
    const len = size - fromByte;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(abs, 'r');
    try {
        fs.readSync(fd, buf, 0, len, fromByte);
    } finally {
        fs.closeSync(fd);
    }
    return {
        text: buf.toString('utf8'),
        nextOffset: size,
        size,
    };
}

function clearFedLogFile(relPath) {
    if (!relPath || String(relPath).includes('..')) {
        return { error: 'Invalid file' };
    }
    try {
        const abs = safeFedPath(relPath);
        if (!fs.existsSync(abs)) {
            return { error: 'not found' };
        }
        if (!fs.statSync(abs).isFile()) {
            return { error: 'not a file' };
        }
        fs.truncateSync(abs, 0);
        fedLineCountCache.delete(abs);
        return { ok: true };
    } catch (e) {
        return { error: e.message };
    }
}

function clearAllFedLogFiles() {
    const root = resolveLogHome();
    if (!fs.existsSync(root)) {
        return { cleared: 0 };
    }
    let cleared = 0;
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                walk(full);
            } else if (ent.isFile() && ent.name.endsWith('.log')) {
                fs.truncateSync(full, 0);
                fedLineCountCache.delete(full);
                cleared++;
            }
        }
    };
    walk(root);
    return { cleared };
}

function getMochaCli() {
    const p = path.join(ROOT, 'node_modules', 'mocha', 'bin', 'mocha.js');
    if (!fs.existsSync(p)) {
        throw new Error(`Mocha not found at ${p}. Run npm install.`);
    }
    return p;
}

function killTestProcess(child) {
    if (!child || !child.pid) return;
    if (process.platform === 'win32') {
        exec(`taskkill /pid ${child.pid} /T /F`, { windowsHide: true }, () => {});
        return;
    }
    try {
        process.kill(-child.pid, 'SIGTERM');
    } catch {
        try {
            child.kill('SIGTERM');
        } catch {
            /* ignore */
        }
    }
}

function killTestProcessHard(child) {
    if (!child || !child.pid) return;
    if (process.platform === 'win32') {
        exec(`taskkill /pid ${child.pid} /T /F`, { windowsHide: true }, () => {});
        return;
    }
    try {
        process.kill(-child.pid, 'SIGKILL');
    } catch {
        try {
            child.kill('SIGKILL');
        } catch {
            /* ignore */
        }
    }
}

function isSetupTest(basename) {
    return basename.startsWith('00');
}

function listTests() {
    const files = glob
        .sync('./tests/**/*.js', { cwd: ROOT })
        .map((p) => path.basename(p))
        .sort();
    return files.map((file) => {
        const base = file.replace(/\.js$/i, '');
        return {
            file,
            prefix: base,
            isSetup: isSetupTest(file),
        };
    });
}

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function serveStatic(res, relPath, contentType) {
    const full = path.join(UI_DIR, relPath);
    if (!full.startsWith(UI_DIR)) {
        res.writeHead(403);
        res.end();
        return;
    }
    fs.readFile(full, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

function formatLogLine(channel, line) {
    const plain = stripAnsi(line);
    let html = ansiToHtml(line);
    if (channel === 'stderr') {
        html = `<span style="color:#ffa657;font-weight:600">[stderr] </span>${html}`;
    }
    return { linePlain: plain, lineHtml: html };
}

function runTests(prefixes) {
    if (currentChild) {
        return { ok: false, error: 'A test run is already in progress.' };
    }
    if (!prefixes || prefixes.length === 0) {
        return { ok: false, error: 'Select at least one test file.' };
    }

    const env = {
        ...process.env,
        INCLUDE_CASES: prefixes.join(','),
        FORCE_COLOR: '1',
        MOCHA_COLORS: '1',
    };
    broadcast('status', { phase: 'starting', message: 'Starting mocha…' });

    const mochaCli = getMochaCli();
    const spawnOpts = {
        cwd: ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
    };

    const child = spawn(
        process.execPath,
        [mochaCli, '--timeout', '1200000', '--color'],
        spawnOpts
    );
    currentChild = child;

    const pumpLines = (stream, channel) => {
        let buf = '';
        stream.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            const parts = buf.split('\n');
            buf = parts.pop() ?? '';
            for (const line of parts) {
                const { linePlain, lineHtml } = formatLogLine(channel, line);
                broadcast('log', { channel, linePlain, lineHtml });
            }
        });
        stream.on('end', () => {
            if (buf.length > 0) {
                const { linePlain, lineHtml } = formatLogLine(channel, buf);
                broadcast('log', { channel, linePlain, lineHtml });
            }
        });
    };
    pumpLines(child.stdout, 'stdout');
    pumpLines(child.stderr, 'stderr');

    child.on('error', (err) => {
        broadcast('status', { phase: 'error', message: err.message });
        currentChild = null;
        if (abortKillTimer) {
            clearTimeout(abortKillTimer);
            abortKillTimer = null;
        }
    });

    child.on('close', (code, signal) => {
        currentChild = null;
        if (abortKillTimer) {
            clearTimeout(abortKillTimer);
            abortKillTimer = null;
        }
        broadcast('done', { code, signal: signal || null });
        broadcast('status', {
            phase: 'finished',
            message:
                code === 0
                    ? 'Tests finished successfully.'
                    : `Tests exited with code ${code}${signal ? ` (signal ${signal})` : ''}.`,
        });
    });

    return { ok: true };
}

function abortRun() {
    if (!currentChild) {
        return { ok: false, error: 'No test run in progress.' };
    }
    const child = currentChild;
    killTestProcess(child);
    broadcast('status', { phase: 'aborted', message: 'Stop requested (SIGTERM to process group).' });

    if (abortKillTimer) {
        clearTimeout(abortKillTimer);
    }
    abortKillTimer = setTimeout(() => {
        abortKillTimer = null;
        if (currentChild) {
            killTestProcessHard(currentChild);
        }
    }, 5000);

    return { ok: true };
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/') {
        serveStatic(res, 'index.html', 'text/html; charset=utf-8');
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tests') {
        sendJson(res, 200, { tests: listTests() });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fed-logs') {
        try {
            sendJson(res, 200, listFedLogs());
        } catch (e) {
            sendJson(res, 500, { error: e.message });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fed-logs/read') {
        const rel = url.searchParams.get('file') || '';
        const from = Number(url.searchParams.get('from') || '0');
        if (!rel || rel.includes('..')) {
            sendJson(res, 400, { error: 'Invalid file' });
            return;
        }
        try {
            const result = readFedLog(rel, Number.isFinite(from) ? from : 0);
            if (result.error) {
                sendJson(res, 404, { error: result.error });
                return;
            }
            sendJson(res, 200, result);
        } catch (e) {
            sendJson(res, 400, { error: e.message });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
        sendJson(res, 200, { running: currentChild != null });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write('\n');
        sseClients.add(res);
        req.on('close', () => {
            sseClients.delete(res);
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
        let body;
        try {
            body = JSON.parse(await readBody(req));
        } catch {
            sendJson(res, 400, { error: 'Invalid JSON body' });
            return;
        }
        const prefixes = Array.isArray(body.prefixes) ? body.prefixes.map(String) : [];
        const result = runTests(prefixes);
        if (!result.ok) {
            sendJson(res, 409, { error: result.error });
            return;
        }
        sendJson(res, 202, { started: true });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/abort') {
        const result = abortRun();
        if (!result.ok) {
            sendJson(res, 409, { error: result.error });
            return;
        }
        sendJson(res, 200, { aborted: true });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fed-logs/clear') {
        let body;
        try {
            body = JSON.parse(await readBody(req));
        } catch {
            sendJson(res, 400, { error: 'Invalid JSON body' });
            return;
        }
        const file = body.file != null ? String(body.file) : '';
        const result = clearFedLogFile(file);
        if (result.error) {
            const status = result.error === 'not found' ? 404 : 400;
            sendJson(res, status, { error: result.error });
            return;
        }
        sendJson(res, 200, { cleared: true });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/fed-logs/clear-all') {
        try {
            const cleared = clearAllFedLogFiles();
            sendJson(res, 200, cleared);
        } catch (e) {
            sendJson(res, 500, { error: e.message });
        }
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, HOST, () => {
    process.stdout.write(
        `Test runner UI: http://${HOST}:${PORT}/\nPress Ctrl+C to stop the server.\n`
    );
});
