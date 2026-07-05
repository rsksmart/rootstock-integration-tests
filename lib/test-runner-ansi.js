/**
 * Strip ANSI escape sequences (for search / classification).
 * @param {string} s
 * @returns {string}
 */
function stripAnsi(s) {
    if (!s) return '';
    /* eslint-disable no-control-regex -- strip CSI / OSC */
    return s
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '');
    /* eslint-enable no-control-regex */
}

const COLOR_8 = {
    30: '#24292f',
    31: '#cf222e',
    32: '#116329',
    33: '#9a6700',
    34: '#0969da',
    35: '#8250df',
    36: '#1b7c83',
    37: '#6e7781',
    90: '#57606a',
    91: '#a40e26',
    92: '#1a7f37',
    93: '#7d4e00',
    94: '#0969da',
    95: '#8250df',
    96: '#1b7c83',
    97: '#6e7781',
};

function rgb256(n) {
    if (n < 8) {
        const colors = [
            '#000000',
            '#cd3131',
            '#0dbc79',
            '#e5e510',
            '#2472c8',
            '#bc3fbc',
            '#11a8cd',
            '#e5e5e5',
        ];
        return colors[n];
    }
    if (n < 16) {
        const colors = [
            '#666666',
            '#f14c4c',
            '#23d18b',
            '#f5f543',
            '#3b8eea',
            '#d670d6',
            '#29b8db',
            '#ffffff',
        ];
        return colors[n - 8];
    }
    if (n < 232) {
        const v = n - 16;
        const r = Math.floor(v / 36);
        const g = Math.floor((v % 36) / 6);
        const b = v % 6;
        const cv = [0, 95, 135, 175, 215, 255];
        return `rgb(${cv[r]},${cv[g]},${cv[b]})`;
    }
    const g = 8 + (n - 232) * 10;
    return `rgb(${g},${g},${g})`;
}

function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>"']/g, (c) => {
        if (c === '&') return '&amp;';
        if (c === '<') return '&lt;';
        if (c === '>') return '&gt;';
        if (c === '"') return '&quot;';
        return c;
    });
}

/**
 * Convert common ANSI SGR sequences to safe HTML spans (Mocha / Chalk style output).
 * @param {string} input
 * @returns {string}
 */
function ansiToHtml(input) {
    if (!input) return '';

    let fg = null;
    let bg = null;
    let bold = false;
    let spanOpen = false;
    let out = '';

    const closeSpan = () => {
        if (spanOpen) {
            out += '</span>';
            spanOpen = false;
        }
    };

    const openSpanIfNeeded = () => {
        closeSpan();
        const bits = [];
        if (fg) bits.push(`color:${fg}`);
        if (bg) bits.push(`background-color:${bg}`);
        if (bold) bits.push('font-weight:600');
        if (bits.length) {
            out += `<span style="${bits.join(';')}">`;
            spanOpen = true;
        }
    };

    const applySequence = (seq) => {
        const parts = seq.length === 0 ? ['0'] : seq.split(';');
        const codes = [];
        for (const p of parts) {
            if (p.trim() === '') continue;
            const n = parseInt(p, 10);
            codes.push(Number.isNaN(n) ? 0 : n);
        }
        if (codes.length === 0) codes.push(0);

        let k = 0;
        while (k < codes.length) {
            const c = codes[k];
            if (c === 0) {
                fg = null;
                bg = null;
                bold = false;
                closeSpan();
                k++;
                continue;
            }
            if (c === 1) {
                bold = true;
                k++;
                continue;
            }
            if (c === 22) {
                bold = false;
                k++;
                continue;
            }
            if (c === 39) {
                fg = null;
                k++;
                continue;
            }
            if (c === 49) {
                bg = null;
                k++;
                continue;
            }
            if (c >= 30 && c <= 37) {
                fg = COLOR_8[c];
                k++;
                continue;
            }
            if (c >= 90 && c <= 97) {
                fg = COLOR_8[c];
                k++;
                continue;
            }
            if (c === 38 && codes[k + 1] === 5 && codes[k + 2] !== undefined) {
                fg = rgb256(codes[k + 2]);
                k += 3;
                continue;
            }
            if (c === 48 && codes[k + 1] === 5 && codes[k + 2] !== undefined) {
                bg = rgb256(codes[k + 2]);
                k += 3;
                continue;
            }
            if (c === 38 && codes[k + 1] === 2 && codes[k + 4] !== undefined) {
                fg = `rgb(${codes[k + 2]},${codes[k + 3]},${codes[k + 4]})`;
                k += 5;
                continue;
            }
            if (c === 48 && codes[k + 1] === 2 && codes[k + 4] !== undefined) {
                bg = `rgb(${codes[k + 2]},${codes[k + 3]},${codes[k + 4]})`;
                k += 5;
                continue;
            }
            k++;
        }
        openSpanIfNeeded();
    };

    let i = 0;
    let textStart = 0;

    while (i < input.length) {
        if (input.charCodeAt(i) === 0x1b && input.charCodeAt(i + 1) === 0x5b) {
            if (i > textStart) {
                out += escapeHtml(input.slice(textStart, i));
            }
            let j = i + 2;
            while (j < input.length && input[j] !== 'm') j++;
            if (j >= input.length) {
                out += escapeHtml(input.slice(i));
                break;
            }
            const seq = input.slice(i + 2, j);
            i = j + 1;
            textStart = i;
            applySequence(seq);
            continue;
        }
        i++;
    }
    if (textStart < input.length) {
        out += escapeHtml(input.slice(textStart));
    }
    closeSpan();
    return out;
}

module.exports = {
    stripAnsi,
    ansiToHtml,
    escapeHtml,
};
