// Utility functions for loop shaping tool

// Generate logarithmically spaced array
function logspace(s, e, n) {
    let tmp = Array(n);
    for (let i = 0; i < n; i++) {
        tmp[i] = s * ((n - 1 - i) / (n - 1)) + e * (i / (n - 1));
    }
    return math.dotPow(10, tmp);
}

// Clip value between min and max
function clip(x, min, max) {
    return math.min(math.max(x, min), max);
}

// Convert root array to math.js complex numbers and sort
function root2math(unsorted_roots) {
    if (unsorted_roots.length == 0) {
        return [];
    }
    let npols = unsorted_roots[0].length;
    let p = new Array(npols);
    for (let i = 0; i < npols; i++) {
        p[i] = math.complex(unsorted_roots[0][i], unsorted_roots[1][i]);
    }
    p.sort((a, b) => {
        if (math.abs(a.re - b.re) < 1e-10) {
            return math.abs(a.im) > math.abs(b.im) ? -1 : 1;
        } else {
            return a.re > b.re ? -1 : 1;
        }
    });
    return p;
}

// Rationalize expression for transfer function
function util_rationalize(eq, vars) {
    let rat;
    if (vars === undefined) {
        rat = math.rationalize(eq, true);
    } else {
        rat = math.rationalize(eq, vars, true);
    }
    if (rat.coefficients.length == 0) {
        if (rat.numerator.op === '-') {
            rat.coefficients = [-rat.numerator.args[0].value];
        } else {
            rat.coefficients = [rat.numerator.value];
        }
    }
    if (rat.denominator === null) {
        rat.denominator = new math.ConstantNode(1);
    }
    return rat;
}

// Convert number to TeX format
function num2tex(num, prec) {
    return num.toPrecision(prec).replace(/(e)([\+-]?\d+)/, '\\times10^{$2}');
}

// Next power of 2 (for FFT)
function nextPow2(n) {
    if (n <= 1) return 1;
    n--;
    n |= n >> 1;
    n |= n >> 2;
    n |= n >> 4;
    n |= n >> 8;
    n |= n >> 16;
    return n + 1;
}

// --- Nyquist shared contour + analysis utilities ---

const NYQUIST_DEFAULTS = {
    epsilon: 1e-4,
    nIndentPoints: 50,
    wMinDecade: -4,
    wMaxDecade: 6,
    wPoints: 2000,
    dedupTol: 1e-12
};

function nyquistUniquePoleFreqs(imagAxisPoles) {
    imagAxisPoles = imagAxisPoles || [];
    let poleFreqs = imagAxisPoles
        .map(p => Math.abs(p.im))
        .sort((a, b) => a - b);
    return [...new Set(poleFreqs.map(f => parseFloat(f.toFixed(10))))];
}

function nyquistConjugateIndentation(indent) {
    if (!indent) return null;
    return { poleIm: -indent.poleIm, theta: -indent.theta };
}

function nyquistPointsEqualS(a, b, tol) {
    if (!a || !b || !a.s || !b.s) return false;
    return (Math.abs(a.s.re - b.s.re) <= tol) && (Math.abs(a.s.im - b.s.im) <= tol);
}

function nyquistConcatDedup(a, b, tol) {
    if (!a || a.length === 0) return b || [];
    if (!b || b.length === 0) return a || [];
    const out = a.slice();
    if (nyquistPointsEqualS(out[out.length - 1], b[0], tol)) {
        out.push(...b.slice(1));
    } else {
        out.push(...b);
    }
    return out;
}

// Generate Nyquist contour points on the s-plane (imag axis + RHP indentations) in full order:
// negative (from -j*wMax to -j*wMin) -> origin indentation -> positive (j*wMin to j*wMax)
// Each point: { s: Complex, indentation: { poleIm, theta } | null }
function generateNyquistContourPoints(wArray, imagAxisPoles, options) {
    options = options || {};

    const epsilon = options.epsilon ?? NYQUIST_DEFAULTS.epsilon;
    const nIndentPoints = options.nIndentPoints ?? NYQUIST_DEFAULTS.nIndentPoints;
    const dedupTol = options.dedupTol ?? NYQUIST_DEFAULTS.dedupTol;

    const poleFreqs = nyquistUniquePoleFreqs(imagAxisPoles);
    const hasOriginPole = poleFreqs.some(f => f < 1e-9);

    // Build positive sweep segments that avoid poles
    let currentStart = hasOriginPole ? epsilon : wArray[0];
    if (wArray[0] > currentStart) currentStart = wArray[0];

    const wEnd = wArray[wArray.length - 1];

    let segments = [];
    for (let poleFreq of poleFreqs) {
        if (poleFreq < 1e-9) continue; // origin handled separately

        if (poleFreq > currentStart + epsilon && poleFreq < wEnd) {
            segments.push({ wStart: currentStart, wEnd: poleFreq - epsilon, poleFreq });
            currentStart = poleFreq + epsilon;
        }
    }
    segments.push({ wStart: currentStart, wEnd: wEnd, poleFreq: null });

    let posPoints = [];

    for (let seg of segments) {
        // Points on imaginary axis
        let segFreqs = wArray.filter(w => w >= seg.wStart && w <= seg.wEnd);
        for (let omega of segFreqs) {
            posPoints.push({ s: math.complex(0, omega), indentation: null });
        }

        // Indentation around non-origin pole (RHP semicircle)
        if (seg.poleFreq !== null) {
            const pFreq = seg.poleFreq;
            for (let k = 0; k <= nIndentPoints; k++) {
                const theta = -Math.PI / 2 + (k * Math.PI / nIndentPoints);
                const sReal = epsilon * Math.cos(theta);
                const sImag = pFreq + epsilon * Math.sin(theta);
                posPoints.push({
                    s: math.complex(sReal, sImag),
                    indentation: { poleIm: pFreq, theta }
                });
            }
        }
    }

    // Negative sweep is conjugate of positive sweep (reverse order)
    let negPoints = [];
    for (let i = posPoints.length - 1; i >= 0; i--) {
        const p = posPoints[i];
        negPoints.push({
            s: p.s ? math.complex(p.s.re, -p.s.im) : null,
            indentation: nyquistConjugateIndentation(p.indentation)
        });
    }

    // Origin indentation (RHP semicircle from -j*eps to +j*eps)
    let originPoints = [];
    if (hasOriginPole) {
        for (let k = 0; k <= nIndentPoints; k++) {
            const theta = -Math.PI / 2 + (k * Math.PI / nIndentPoints);
            const sReal = epsilon * Math.cos(theta);
            const sImag = epsilon * Math.sin(theta);
            originPoints.push({
                s: math.complex(sReal, sImag),
                indentation: { poleIm: 0, theta }
            });
        }
    }

    // Combine with de-duplication at joins
    let allPoints = nyquistConcatDedup(negPoints, originPoints, dedupTol);
    allPoints = nyquistConcatDedup(allPoints, posPoints, dedupTol);

    return { points: allPoints, poleFreqs, hasOriginPole, epsilon };
}

// Compute winding number from already-evaluated L(s) along a contour.
// The angle is of vector (L(s) - (-1)) = L(s) + 1.
function computeWindingNumberFromEvaluations(evaluatedPoints) {
    let totalDelta = 0;
    let prevAngle = null;

    for (let p of evaluatedPoints) {
        if (!p || !p.L) continue;
        const shiftedRe = p.L.re + 1;
        const shiftedIm = p.L.im;
        if (!isFinite(shiftedRe) || !isFinite(shiftedIm)) continue;

        const angle = Math.atan2(shiftedIm, shiftedRe);
        if (prevAngle !== null) {
            let deltaAngle = angle - prevAngle;
            while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
            while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
            totalDelta += deltaAngle;
        }
        prevAngle = angle;
    }

    // N is defined as clockwise-positive in this app.
    return Math.round(-totalDelta / (2 * Math.PI));
}

// Evaluate L(s) once along the full Nyquist contour and compute N.
// Returns { points: [{s, indentation, L:{re,im}}...], N, poleFreqs, hasOriginPole, epsilon, wArray }
function computeNyquistAnalysis(Lcompiled, imagAxisPoles, options) {
    options = options || {};

    const wArray = options.wArray || logspace(
        options.wMinDecade ?? NYQUIST_DEFAULTS.wMinDecade,
        options.wMaxDecade ?? NYQUIST_DEFAULTS.wMaxDecade,
        options.wPoints ?? NYQUIST_DEFAULTS.wPoints
    );

    const contour = generateNyquistContourPoints(wArray, imagAxisPoles, options);
    const evaluated = [];

    for (let p of contour.points) {
        try {
            const Lval = Lcompiled.evaluate({ 's': p.s });
            if (typeof Lval?.re === 'number' && isFinite(Lval.re) && isFinite(Lval.im)) {
                evaluated.push({ s: p.s, indentation: p.indentation || null, L: { re: Lval.re, im: Lval.im } });
            }
        } catch (e) {
            // Skip evaluation failures
        }
    }

    const N = computeWindingNumberFromEvaluations(evaluated);

    return {
        points: evaluated,
        N,
        poleFreqs: contour.poleFreqs,
        hasOriginPole: contour.hasOriginPole,
        epsilon: contour.epsilon,
        wArray
    };
}

// Calculate winding number around (-1, 0) for Nyquist stability criterion
// (Kept for backward compatibility; now uses shared Nyquist analysis so the contour is consistent.)
function calculateWindingNumber(Lcompiled, wArray, imagAxisPoles) {
    const analysis = computeNyquistAnalysis(Lcompiled, imagAxisPoles, { wArray });
    return analysis ? analysis.N : 0;
}

// Helper function to calculate accumulated angle change along a path
function calculatePathAngleChange(Lcompiled, points) {
    let totalDelta = 0;
    let prevAngle = null;

    for (let s of points) {
        try {
            let Lval = Lcompiled.evaluate({ 's': s });
            
            // Vector from (-1, 0) to L(s) is L(s) - (-1) = L(s) + 1
            let shiftedRe = Lval.re + 1;
            let shiftedIm = Lval.im;
            
            if (!isFinite(shiftedRe) || !isFinite(shiftedIm)) continue;

            let angle = Math.atan2(shiftedIm, shiftedRe);
            
            if (prevAngle !== null) {
                let deltaAngle = angle - prevAngle;
                // Unwrap angle
                while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
                while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
                totalDelta += deltaAngle;
            }
            prevAngle = angle;
        } catch (e) { continue; }
    }
    return totalDelta;
}

// Find poles on or near the imaginary axis from a rational function
function findImaginaryAxisPoles(rationalNode) {
    try {
        let rat = util_rationalize(rationalNode);
        if (!rat || !rat.denominator) return [];

        let denStr = rat.denominator.toString();
        let denPoly = math.rationalize(denStr, true);
        if (!denPoly.coefficients || denPoly.coefficients.length <= 1) return [];

        let roots = findRoots(denPoly.coefficients);
        let poles = root2math(roots);

        // Return poles that are on or very close to the imaginary axis
        let imagPoles = poles.filter(p => Math.abs(p.re) < 1e-6);
        return imagPoles;
    } catch (e) {
        console.log('Error finding imaginary axis poles:', e);
        return [];
    }
}

// Count poles on the imaginary axis (these need special handling)
function countImaginaryAxisPoles(rationalNode) {
    let imagPoles = findImaginaryAxisPoles(rationalNode);
    return imagPoles.length;
}

// Analyze L(s) structure to determine if it's:
// 1. Rational function: L(s) = N(s)/D(s)
// 2. Rational * exp(-Ts): L(s) = R(s) * exp(-T*s) where R(s) is rational
// 3. Other (cannot determine P)
// Returns: { type: 'rational'|'rational_delay'|'unknown', rationalPart: node|null, delayTime: number|null }
function analyzeLstructure(Lnode) {
    // Helper to check if a node is exp(-T*s) form
    function isDelayExp(node) {
        if (!node.isFunctionNode || node.fn.name !== 'exp') return null;
        if (node.args.length !== 1) return null;

        let arg = node.args[0];
        // Check for -T*s or -s*T or -(T*s)
        if (arg.isOperatorNode && arg.op === '-' && arg.fn === 'unaryMinus') {
            arg = arg.args[0];
        } else if (arg.isOperatorNode && arg.op === '*') {
            // Check if one factor is negative
            let hasNegative = false;
            let factors = [];
            for (let a of arg.args) {
                if (a.isOperatorNode && a.op === '-' && a.fn === 'unaryMinus') {
                    hasNegative = true;
                    factors.push(a.args[0]);
                } else if (a.isConstantNode && a.value < 0) {
                    hasNegative = true;
                    factors.push(new math.ConstantNode(-a.value));
                } else {
                    factors.push(a);
                }
            }
            if (!hasNegative) return null;
            arg = factors.length === 1 ? factors[0] :
                  new math.OperatorNode('*', 'multiply', factors);
        } else {
            return null;
        }

        // Now arg should be T*s or s*T or just s
        let delayTime = null;
        if (arg.isSymbolNode && arg.name === 's') {
            delayTime = 1;
        } else if (arg.isOperatorNode && arg.op === '*') {
            let hasS = false;
            let timeValue = 1;
            for (let a of arg.args) {
                if (a.isSymbolNode && a.name === 's') {
                    hasS = true;
                } else if (a.isConstantNode) {
                    timeValue *= a.value;
                } else {
                    return null; // Complex expression, can't analyze
                }
            }
            if (hasS) delayTime = timeValue;
        }

        return delayTime;
    }

    // Helper to check if node contains exp(-T*s)
    function findDelayInProduct(node) {
        if (node.isFunctionNode) {
            let delay = isDelayExp(node);
            if (delay !== null) {
                return { delayNode: node, delayTime: delay };
            }
        }
        if (node.isOperatorNode && node.op === '*') {
            for (let arg of node.args) {
                let result = findDelayInProduct(arg);
                if (result) return result;
            }
        }
        if (node.isOperatorNode && node.op === '/') {
            // Only check numerator for delay
            let result = findDelayInProduct(node.args[0]);
            if (result) return result;
        }
        return null;
    }

    // Helper to remove delay from expression
    function removeDelay(node, delayNode) {
        if (node === delayNode) {
            return new math.ConstantNode(1);
        }
        if (node.isOperatorNode && node.op === '*') {
            let newArgs = [];
            for (let arg of node.args) {
                let cleaned = removeDelay(arg, delayNode);
                if (!(cleaned.isConstantNode && cleaned.value === 1)) {
                    newArgs.push(cleaned);
                }
            }
            if (newArgs.length === 0) return new math.ConstantNode(1);
            if (newArgs.length === 1) return newArgs[0];
            return new math.OperatorNode('*', 'multiply', newArgs);
        }
        if (node.isOperatorNode && node.op === '/') {
            let num = removeDelay(node.args[0], delayNode);
            let den = node.args[1];
            return new math.OperatorNode('/', 'divide', [num, den]);
        }
        return node.clone();
    }

    // First, check if it's a pure rational function
    try {
        let rat = util_rationalize(Lnode);
        if (rat) {
            return { type: 'rational', rationalPart: Lnode, delayTime: null };
        }
    } catch (e) {
        // Not purely rational, continue checking
    }

    // Check for R(s) * exp(-Ts) form
    let delayInfo = findDelayInProduct(Lnode);
    if (delayInfo) {
        let rationalPart = removeDelay(Lnode, delayInfo.delayNode);
        // Verify the remaining part is rational
        try {
            let rat = util_rationalize(rationalPart);
            if (rat) {
                return {
                    type: 'rational_delay',
                    rationalPart: rationalPart,
                    delayTime: delayInfo.delayTime
                };
            }
        } catch (e) {
            // Rational part is not actually rational
        }
    }

    return { type: 'unknown', rationalPart: null, delayTime: null };
}

// Count open-loop poles in the right half plane
function countRHPpoles(rationalNode) {
    try {
        let rat = util_rationalize(rationalNode);
        if (!rat || !rat.denominator) return 0;

        let denStr = rat.denominator.toString();
        let denPoly = math.rationalize(denStr, true);
        if (!denPoly.coefficients || denPoly.coefficients.length <= 1) return 0;

        let roots = findRoots(denPoly.coefficients);
        let poles = root2math(roots);

        let rhpCount = 0;
        for (let p of poles) {
            if (p.re > 1e-10) rhpCount++;
        }
        return rhpCount;
    } catch (e) {
        console.log('Error counting RHP poles:', e);
        return null; // Cannot determine
    }
}

// Durand-Kerner method for finding polynomial roots
// coeffs: polynomial coefficients [a0, a1, ..., an] for a0 + a1*s + ... + an*s^n
function findRoots(coeffs, complexCoeffs, maxIterations, tolerance) {
    maxIterations = maxIterations || 100000;
    tolerance = tolerance || 1e-10;

    // Normalize coefficients
    let n = coeffs.length - 1;
    if (n <= 0) {
        return [[], []];
    }

    // Normalize so leading coefficient is 1
    let leadingCoeff = coeffs[n];
    let normalizedCoeffs = coeffs.map(c => {
        if (typeof c === 'object' && c.re !== undefined) {
            return math.divide(c, leadingCoeff);
        }
        return c / leadingCoeff;
    });

    // Initialize roots with Aberth method initial values
    let roots = [];
    let rootsReal = [];
    let rootsImag = [];

    // Initial estimates spread around a circle
    let radius = 1;
    for (let i = 0; i < n; i++) {
        let angle = 2 * Math.PI * i / n + Math.PI / (2 * n);
        rootsReal.push(radius * Math.cos(angle));
        rootsImag.push(radius * Math.sin(angle));
    }

    // Evaluate polynomial at complex point
    function evalPoly(coeffs, re, im) {
        let resultRe = 0, resultIm = 0;
        let powRe = 1, powIm = 0;

        for (let i = 0; i < coeffs.length; i++) {
            let c = coeffs[i];
            let cRe, cIm;
            if (typeof c === 'object' && c.re !== undefined) {
                cRe = c.re;
                cIm = c.im || 0;
            } else {
                cRe = c;
                cIm = 0;
            }

            resultRe += cRe * powRe - cIm * powIm;
            resultIm += cRe * powIm + cIm * powRe;

            // Multiply by (re + i*im)
            let newPowRe = powRe * re - powIm * im;
            let newPowIm = powRe * im + powIm * re;
            powRe = newPowRe;
            powIm = newPowIm;
        }

        return [resultRe, resultIm];
    }

    // Durand-Kerner iteration
    for (let iter = 0; iter < maxIterations; iter++) {
        let maxChange = 0;

        for (let i = 0; i < n; i++) {
            // Evaluate polynomial at current root estimate
            let [pRe, pIm] = evalPoly(normalizedCoeffs, rootsReal[i], rootsImag[i]);

            // Calculate product of (z_i - z_j) for j != i
            let prodRe = 1, prodIm = 0;
            for (let j = 0; j < n; j++) {
                if (i !== j) {
                    let diffRe = rootsReal[i] - rootsReal[j];
                    let diffIm = rootsImag[i] - rootsImag[j];

                    let newProdRe = prodRe * diffRe - prodIm * diffIm;
                    let newProdIm = prodRe * diffIm + prodIm * diffRe;
                    prodRe = newProdRe;
                    prodIm = newProdIm;
                }
            }

            // Calculate correction: p(z_i) / prod(z_i - z_j)
            let denom = prodRe * prodRe + prodIm * prodIm;
            if (denom < 1e-30) denom = 1e-30;

            let corrRe = (pRe * prodRe + pIm * prodIm) / denom;
            let corrIm = (pIm * prodRe - pRe * prodIm) / denom;

            // Update root
            rootsReal[i] -= corrRe;
            rootsImag[i] -= corrIm;

            let change = Math.sqrt(corrRe * corrRe + corrIm * corrIm);
            maxChange = Math.max(maxChange, change);
        }

        if (maxChange < tolerance) {
            break;
        }
    }

    return [rootsReal, rootsImag];
}
