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
