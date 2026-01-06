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

// Calculate winding number around (-1, 0) for Nyquist stability criterion
function calculateWindingNumber(Lcompiled, wArray, imagAxisPoles) {
    imagAxisPoles = imagAxisPoles || [];

    // Sort pole frequencies
    let poleFreqs = imagAxisPoles
        .map(p => Math.abs(p.im))
        .sort((a, b) => a - b);
    poleFreqs = [...new Set(poleFreqs.map(f => parseFloat(f.toFixed(10))))];

    const epsilon = 1e-4;
    const hasOriginPole = poleFreqs.some(f => f < 1e-9);

    // --- Part 1: Origin Indentation (Count ONCE) ---
    // Calculates angle change from s = -j*eps to s = +j*eps via RHP semicircle
    let originAngleChange = 0;
    
    if (hasOriginPole) {
        let originPoints = [];
        const nIndentPoints = 50;
        // Sweep from -PI/2 to +PI/2 (Bottom to Top around origin in RHP)
        for (let k = 0; k <= nIndentPoints; k++) {
            let theta = -Math.PI / 2 + (k * Math.PI / nIndentPoints);
            let sReal = epsilon * Math.cos(theta);
            let sImag = epsilon * Math.sin(theta);
            originPoints.push(math.complex(sReal, sImag));
        }
        originAngleChange = calculatePathAngleChange(Lcompiled, originPoints);
    }


    // --- Part 2: Positive Frequency Sweep (Count TWICE) ---
    // Calculates angle change from s = +j*eps to s = +j*inf
    let posPoints = [];
    
    // Determine start frequency
    let currentStart = hasOriginPole ? epsilon : wArray[0];
    if (wArray[0] > currentStart) currentStart = wArray[0];

    // Build segments avoiding non-origin poles
    let segments = [];
    for (let poleFreq of poleFreqs) {
        // Skip origin pole as it's handled in Part 1
        if (poleFreq < 1e-9) continue; 

        if (poleFreq > currentStart + epsilon && poleFreq < wArray[wArray.length - 1]) {
            segments.push({
                wStart: currentStart,
                wEnd: poleFreq - epsilon,
                poleFreq: poleFreq
            });
            currentStart = poleFreq + epsilon;
        }
    }
    segments.push({
        wStart: currentStart,
        wEnd: wArray[wArray.length - 1],
        poleFreq: null
    });

    // Generate points for positive sweep
    for (let seg of segments) {
        // Normal frequency points
        let segFreqs = wArray.filter(w => w >= seg.wStart && w <= seg.wEnd);
        for (let omega of segFreqs) {
            posPoints.push(math.complex(0, omega));
        }

        // Indentation around non-origin pole (Semicircle in RHP)
        if (seg.poleFreq !== null) {
            let pFreq = seg.poleFreq;
            const nIndentPoints = 50;
            // Sweep from -PI/2 to +PI/2 relative to the pole
            for (let k = 0; k <= nIndentPoints; k++) {
                let theta = -Math.PI / 2 + (k * Math.PI / nIndentPoints);
                let sReal = epsilon * Math.cos(theta);
                let sImag = pFreq + epsilon * Math.sin(theta);
                posPoints.push(math.complex(sReal, sImag));
            }
        }
    }

    let posPathAngleChange = calculatePathAngleChange(Lcompiled, posPoints);


    // --- Combine Results ---
    // Total = Origin(once) + PositivePath(twice for symmetry)
    let totalAngle = originAngleChange + (2 * posPathAngleChange);

    // FIX: N is Clockwise positive, but atan2 is Counter-Clockwise positive.
    // So we invert the sign.
    let N = Math.round(-totalAngle / (2 * Math.PI));

    return N;
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
