// Utility functions for loop shaping tool

// Tolerance for detecting poles/zeros on or near the imaginary axis.
// Poles with |Re(s)| < IMAG_AXIS_TOL are treated as imaginary axis poles.
// This threshold must be used consistently for: origin pole detection,
// RHP pole counting, Nyquist indentation, and pole/zero display formatting.
const IMAG_AXIS_TOL = 1e-6;

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

// Convert number to TeX format (values < IMAG_AXIS_TOL are treated as 0)
function num2tex(num, prec) {
    if (Math.abs(num) < IMAG_AXIS_TOL) num = 0;
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
    const hasOriginPole = poleFreqs.some(f => f < IMAG_AXIS_TOL);

    // Build positive sweep segments that avoid poles
    let currentStart = hasOriginPole ? epsilon : wArray[0];
    if (wArray[0] > currentStart) currentStart = wArray[0];

    const wEnd = wArray[wArray.length - 1];

    let segments = [];
    for (let poleFreq of poleFreqs) {
        if (poleFreq < IMAG_AXIS_TOL) continue; // origin handled separately

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
        let imagPoles = poles.filter(p => Math.abs(p.re) < IMAG_AXIS_TOL);
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
            if (p.re > IMAG_AXIS_TOL) rhpCount++;
        }
        return rhpCount;
    } catch (e) {
        console.log('Error counting RHP poles:', e);
        return null; // Cannot determine
    }
}

// --- Step Response Simulation Utilities ---

// Convert transfer function coefficients to observable canonical form state-space
// G(s) = (b0 + b1*s + ... + bm*s^m) / (a0 + a1*s + ... + an*s^n)
// Returns: { A, B, C, D, n } where n is the order
function tf2ss(numCoeffs, denCoeffs) {
    // Normalize so leading denominator coefficient is 1
    let n = denCoeffs.length - 1;  // System order

    if (n <= 0) {
        // Static gain (no dynamics)
        let D = numCoeffs[0] / denCoeffs[0];
        return { A: [], B: [], C: [], D: D, n: 0 };
    }

    let an = denCoeffs[n];  // Leading coefficient
    let a = denCoeffs.map(c => c / an);  // Normalized [a0, a1, ..., a_{n-1}, 1]

    // Normalize numerator by the same factor
    let b = numCoeffs.map(c => c / an);

    // Pad numerator to length n+1.
    // Coefficients are ASCENDING powers of s: [b0, b1, ..., bn].
    // So if deg(num) < n, we must append zeros for the missing HIGH-order terms.
    while (b.length < n + 1) {
        b.push(0);
    }

    // D = direct feedthrough (coefficient of s^n in numerator)
    let D = b[n];

    // Observable canonical form (transposed controllable form)
    // This form is: dx/dt = A*x + B*u, y = C*x + D*u
    // where A is companion matrix, B contains modified numerator coeffs, C = [0,...,0,1]
    //
    // For G(s) = (b_n*s^n + ... + b_0) / (s^n + a_{n-1}*s^{n-1} + ... + a_0)
    //
    // A = [[-a_{n-1}, 1, 0, ..., 0],
    //      [-a_{n-2}, 0, 1, ..., 0],
    //      ...
    //      [-a_1,     0, 0, ..., 1],
    //      [-a_0,     0, 0, ..., 0]]
    //
    // B = [b_{n-1} - a_{n-1}*D, b_{n-2} - a_{n-2}*D, ..., b_0 - a_0*D]^T
    // C = [1, 0, 0, ..., 0]

    let A = [];
    for (let i = 0; i < n; i++) {
        let row = new Array(n).fill(0);
        row[0] = -a[n - 1 - i];  // First column: [-a_{n-1}, -a_{n-2}, ..., -a_0]
        if (i < n - 1) {
            row[i + 1] = 1;  // Superdiagonal of 1s
        }
        A.push(row);
    }

    // B = [b_{n-1} - a_{n-1}*D, b_{n-2} - a_{n-2}*D, ..., b_0 - a_0*D]^T
    let B = new Array(n);
    for (let i = 0; i < n; i++) {
        B[i] = b[n - 1 - i] - a[n - 1 - i] * D;
    }

    // C = [1, 0, 0, ..., 0]
    let C = new Array(n).fill(0);
    C[0] = 1;

    return { A, B, C, D, n };
}

// Matrix-vector multiplication: y = A * x
function matVecMult(A, x) {
    let n = x.length;
    let y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            y[i] += A[i][j] * x[j];
        }
    }
    return y;
}

// Vector addition: y = a + b
function vecAdd(a, b) {
    return a.map((v, i) => v + b[i]);
}

// Scalar-vector multiplication: y = k * x
function vecScale(k, x) {
    return x.map(v => k * v);
}

// Dot product: y = a · b
function vecDot(a, b) {
    return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

// 4th-order Runge-Kutta integration for state-space system with dead time
// dx/dt = A*x + B*u(t - delay)
// y = C*x + D*u(t - delay)
// For step input: u(t) = 1 for t >= 0
// Returns: { time: [...], yL: [...], yT: [...] }
function simulateStepResponse(ssL, ssT, tMax, nPoints, delayL, delayT) {
    delayL = delayL || 0;
    delayT = delayT || 0;

    let dt = tMax / (nPoints - 1);
    let time = [];
    let yL = [];
    let yT = [];

    // Initialize state vectors
    let xL = ssL && ssL.n > 0 ? new Array(ssL.n).fill(0) : [];
    let xT = ssT && ssT.n > 0 ? new Array(ssT.n).fill(0) : [];

    // Step input function with delay
    function stepInput(t, delay) {
        return t >= delay ? 1 : 0;
    }

    // State derivative: dx/dt = A*x + B*u
    function dxdt(A, B, x, u) {
        if (x.length === 0) return [];
        let Ax = matVecMult(A, x);
        let Bu = vecScale(u, B);
        return vecAdd(Ax, Bu);
    }

    // RK4 step
    function rk4Step(A, B, x, u, dt) {
        if (x.length === 0) return [];
        let k1 = dxdt(A, B, x, u);
        let k2 = dxdt(A, B, vecAdd(x, vecScale(dt / 2, k1)), u);
        let k3 = dxdt(A, B, vecAdd(x, vecScale(dt / 2, k2)), u);
        let k4 = dxdt(A, B, vecAdd(x, vecScale(dt, k3)), u);

        // x_new = x + (dt/6) * (k1 + 2*k2 + 2*k3 + k4)
        let sum = vecAdd(k1, vecScale(2, k2));
        sum = vecAdd(sum, vecScale(2, k3));
        sum = vecAdd(sum, k4);
        return vecAdd(x, vecScale(dt / 6, sum));
    }

    // Simulation loop
    for (let i = 0; i < nPoints; i++) {
        let t = i * dt;
        time.push(t);

        // Get input values (with delay)
        let uL = stepInput(t, delayL);
        let uT = stepInput(t, delayT);

        // Compute outputs: y = C*x + D*u
        let outL = 0;
        if (ssL) {
            if (ssL.n > 0) {
                outL = vecDot(ssL.C, xL) + ssL.D * uL;
            } else {
                outL = ssL.D * uL;
            }
        }

        let outT = 0;
        if (ssT) {
            if (ssT.n > 0) {
                outT = vecDot(ssT.C, xT) + ssT.D * uT;
            } else {
                outT = ssT.D * uT;
            }
        }

        yL.push(outL);
        yT.push(outT);

        // Update states (RK4)
        if (ssL && ssL.n > 0) {
            xL = rk4Step(ssL.A, ssL.B, xL, uL, dt);
        }
        if (ssT && ssT.n > 0) {
            xT = rk4Step(ssT.A, ssT.B, xT, uT, dt);
        }
    }

    return { time, yL, yT };
}

// Closed-loop step response for unity feedback when the loop transfer is L(s)=R(s)*exp(-delay*s)
// i.e., the dead time is INSIDE the feedback loop (not a pure output delay).
//
// Model:
//   y(t) = R(s) * e(t-delay)
//   e(t) = r(t) - y(t),  r(t)=1 (step)
//
// State-space of R:
//   dx/dt = A x + B u,  y = C x + D u,  u(t) = e(t-delay)
//
// Returns: { time: [...], y: [...], e: [...] }
function simulateClosedLoopStepResponseLoopDelay(ssR, delay, tMax, nPoints) {
    delay = delay || 0;
    const dt = tMax / (nPoints - 1);

    const time = [];
    const y = [];
    const e = [];

    // State vector
    let x = ssR && ssR.n > 0 ? new Array(ssR.n).fill(0) : [];

    // Linear interpolation of e(t) history.
    // For tQuery<0 => 0.
    // For tQuery>tKnownMax => hold e at tKnownMax (prevents needing "future" within RK4 substeps when delay is very small).
    function eDelayed(tQuery, tKnownMax) {
        if (tQuery < 0) return 0;
        if (e.length === 0) return 0;

        // Clamp to known range
        if (tQuery > tKnownMax) {
            return e[e.length - 1];
        }

        const idx = tQuery / dt;
        const i0 = Math.floor(idx);
        const frac = idx - i0;

        if (i0 <= 0) return e[0];
        if (i0 >= e.length - 1) return e[e.length - 1];

        const e0 = e[i0];
        const e1 = e[i0 + 1];
        return e0 + frac * (e1 - e0);
    }

    function dxdt(A, B, xVec, u) {
        if (xVec.length === 0) return [];
        const Ax = matVecMult(A, xVec);
        const Bu = vecScale(u, B);
        return vecAdd(Ax, Bu);
    }

    // RK4 step with input sampled via a callback u(tSub)
    function rk4StepWithU(A, B, xVec, tBase, uAtTime, dtLocal, tKnownMax) {
        if (xVec.length === 0) return [];

        const u1 = uAtTime(tBase, tKnownMax);
        const k1 = dxdt(A, B, xVec, u1);

        const u2 = uAtTime(tBase + dtLocal / 2, tKnownMax);
        const k2 = dxdt(A, B, vecAdd(xVec, vecScale(dtLocal / 2, k1)), u2);

        const u3 = uAtTime(tBase + dtLocal / 2, tKnownMax);
        const k3 = dxdt(A, B, vecAdd(xVec, vecScale(dtLocal / 2, k2)), u3);

        const u4 = uAtTime(tBase + dtLocal, tKnownMax);
        const k4 = dxdt(A, B, vecAdd(xVec, vecScale(dtLocal, k3)), u4);

        let sum = vecAdd(k1, vecScale(2, k2));
        sum = vecAdd(sum, vecScale(2, k3));
        sum = vecAdd(sum, k4);
        return vecAdd(xVec, vecScale(dtLocal / 6, sum));
    }

    // Simulation loop
    for (let i = 0; i < nPoints; i++) {
        const t = i * dt;
        time.push(t);

        // Known e samples are available up to current time t after we compute e(t).
        // For output at time t, the delayed input is e(t-delay) which is always in the past for delay>0.
        const uNow = eDelayed(t - delay, t);

        // Output y(t)
        let yNow = 0;
        if (ssR) {
            if (ssR.n > 0) {
                yNow = vecDot(ssR.C, x) + ssR.D * uNow;
            } else {
                yNow = ssR.D * uNow;
            }
        }
        y.push(yNow);

        // Error e(t) = r(t) - y(t), with r(t)=1 for t>=0
        const eNow = 1 - yNow;
        e.push(eNow);

        // State update to t+dt using RK4 with u(tSub) = e(tSub - delay)
        if (ssR && ssR.n > 0 && i < nPoints - 1) {
            const uAtTime = (tSub, tKnownMax) => eDelayed(tSub - delay, tKnownMax);
            x = rk4StepWithU(ssR.A, ssR.B, x, t, uAtTime, dt, t);
        }
    }

    return { time, y, e };
}

// Extract polynomial coefficients from rationalized transfer function node
// Returns: { num: [b0, b1, ...], den: [a0, a1, ...] } (ascending powers of s)
function extractTFCoeffs(ratNode) {
    if (!ratNode || !ratNode.numerator || !ratNode.denominator) {
        return null;
    }

    let numCoeffs = [];
    let denCoeffs = [];

    try {
        // Get numerator coefficients
        let numStr = ratNode.numerator.toString();
        let numPoly = math.rationalize(numStr, true);
        if (numPoly.coefficients && numPoly.coefficients.length > 0) {
            numCoeffs = numPoly.coefficients.slice();  // Already in ascending order
        } else {
            // Constant numerator
            try {
                numCoeffs = [numPoly.numerator.value || 1];
            } catch (e) {
                numCoeffs = [1];
            }
        }

        // Get denominator coefficients
        let denStr = ratNode.denominator.toString();
        let denPoly = math.rationalize(denStr, true);
        if (denPoly.coefficients && denPoly.coefficients.length > 0) {
            denCoeffs = denPoly.coefficients.slice();  // Already in ascending order
        } else {
            // Constant denominator
            try {
                denCoeffs = [denPoly.numerator.value || 1];
            } catch (e) {
                denCoeffs = [1];
            }
        }

        return { num: numCoeffs, den: denCoeffs };
    } catch (e) {
        console.log('Error extracting TF coefficients:', e);
        return null;
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

// ============================================================================
// Padé Approximation for Time Delay
// ============================================================================

// Calculate Padé coefficient for [n/m] approximant of e^(-x)
// Returns coefficient a_k where:
//   Numerator: sum_{k=0}^{n} (-1)^k * a_k * x^k
//   Denominator: sum_{k=0}^{m} b_k * x^k
// Formula: coeff(n, m, k) = (n+m-k)! * n! / ((n+m)! * k! * (n-k)!)
function padeCoeff(n, m, k) {
    // Using iterative calculation to avoid factorial overflow
    // coeff = product_{i=0}^{k-1} [(n-i) / ((n+m-i) * (i+1))]
    let result = 1;
    for (let i = 0; i < k; i++) {
        result *= (n - i) / ((n + m - i) * (i + 1));
    }
    return result;
}

// Build Padé approximation AST node for e^(-Ld*s)
// Ld: math.js node (SymbolNode, ConstantNode, or expression)
// n: numerator order (integer)
// m: denominator order (integer)
function buildPadeNode(Ld, n, m) {
    const s = new math.SymbolNode('s');

    // Helper: build a single term: coeff * (Ld*s)^k
    function buildTerm(coeff, k) {
        if (k === 0) {
            return new math.ConstantNode(coeff);
        }

        // (Ld * s)
        const LdS = new math.OperatorNode('*', 'multiply', [Ld.clone(), s.clone()]);

        // (Ld * s)^k
        const power = k === 1 ? LdS : new math.OperatorNode('^', 'pow', [LdS, new math.ConstantNode(k)]);

        // coeff * (Ld * s)^k
        if (coeff === 1) {
            return power;
        }
        return new math.OperatorNode('*', 'multiply', [new math.ConstantNode(coeff), power]);
    }

    // Helper: sum an array of terms
    function sumTerms(terms) {
        if (terms.length === 0) return new math.ConstantNode(0);
        if (terms.length === 1) return terms[0];

        let result = terms[0];
        for (let i = 1; i < terms.length; i++) {
            result = new math.OperatorNode('+', 'add', [result, terms[i]]);
        }
        return result;
    }

    // Build numerator: sum_{k=0}^{n} (-1)^k * a_k * (Ld*s)^k
    let numTerms = [];
    for (let k = 0; k <= n; k++) {
        const coeff = padeCoeff(n, m, k);
        const sign = (k % 2 === 0) ? 1 : -1;
        numTerms.push(buildTerm(coeff * sign, k));
    }

    // Build denominator: sum_{k=0}^{m} b_k * (Ld*s)^k
    let denTerms = [];
    for (let k = 0; k <= m; k++) {
        const coeff = padeCoeff(m, n, k);
        denTerms.push(buildTerm(coeff, k));
    }

    const num = sumTerms(numTerms);
    const den = sumTerms(denTerms);

    return new math.OperatorNode('/', 'divide', [num, den]);
}

// Expand pade_delay function calls in an AST
// Transforms pade_delay(Ld, n) or pade_delay(Ld, n, m) into rational expression
function expandPadeDelay(node) {
    return node.transform(function(node, path, parent) {
        if (node.isFunctionNode && node.fn && node.fn.name === 'pade_delay') {
            const args = node.args;

            if (args.length < 2 || args.length > 3) {
                throw new Error('pade_delay requires 2 or 3 arguments: pade_delay(Ld, n) or pade_delay(Ld, n, m)');
            }

            const Ld = args[0];
            const nArg = args[1];
            const mArg = args.length > 2 ? args[2] : args[1]; // Default m = n

            // n and m must be constant integers
            if (!nArg.isConstantNode || !Number.isInteger(nArg.value) || nArg.value < 0) {
                throw new Error('pade_delay: n must be a non-negative integer constant');
            }
            if (!mArg.isConstantNode || !Number.isInteger(mArg.value) || mArg.value < 0) {
                throw new Error('pade_delay: m must be a non-negative integer constant');
            }

            const n = nArg.value;
            const m = mArg.value;

            if (n === 0 && m === 0) {
                return new math.ConstantNode(1); // e^0 = 1
            }

            return buildPadeNode(Ld, n, m);
        }
        return node;
    });
}
