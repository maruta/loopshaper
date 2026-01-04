// Web Worker for calculating closed-loop poles

importScripts("https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.11.2/math.min.js");

// Utility function for rationalization
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
        rat.denominator = new math.expression.node.ConstantNode(1);
    }
    return rat;
}

// Durand-Kerner method for finding polynomial roots
function findRoots(coeffs, complexCoeffs, maxIterations, tolerance) {
    maxIterations = maxIterations || 100000;
    tolerance = tolerance || 1e-10;

    let n = coeffs.length - 1;
    if (n <= 0) {
        return [[], []];
    }

    let leadingCoeff = coeffs[n];
    let normalizedCoeffs = coeffs.map(c => {
        if (typeof c === 'object' && c.re !== undefined) {
            return math.divide(c, leadingCoeff);
        }
        return c / leadingCoeff;
    });

    let rootsReal = [];
    let rootsImag = [];

    let radius = 1;
    for (let i = 0; i < n; i++) {
        let angle = 2 * Math.PI * i / n + Math.PI / (2 * n);
        rootsReal.push(radius * Math.cos(angle));
        rootsImag.push(radius * Math.sin(angle));
    }

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

            let newPowRe = powRe * re - powIm * im;
            let newPowIm = powRe * im + powIm * re;
            powRe = newPowRe;
            powIm = newPowIm;
        }

        return [resultRe, resultIm];
    }

    for (let iter = 0; iter < maxIterations; iter++) {
        let maxChange = 0;

        for (let i = 0; i < n; i++) {
            let [pRe, pIm] = evalPoly(normalizedCoeffs, rootsReal[i], rootsImag[i]);

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

            let denom = prodRe * prodRe + prodIm * prodIm;
            if (denom < 1e-30) denom = 1e-30;

            let corrRe = (pRe * prodRe + pIm * prodIm) / denom;
            let corrIm = (pIm * prodRe - pRe * prodIm) / denom;

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

onmessage = function (e) {
    try {
        let Peq = JSON.parse(e.data[0], math.json.reviver);
        let Keq = JSON.parse(e.data[1], math.json.reviver);
        let Prat = util_rationalize(Peq);
        let Krat = util_rationalize(Keq);

        // Characteristic polynomial: P_den * K_den + P_num * K_num = 0
        let phi = math.rationalize(
            new math.expression.node.OperatorNode('+', 'add', [
                new math.expression.node.OperatorNode('*', 'multiply', [Prat.denominator, Krat.denominator]),
                new math.expression.node.OperatorNode('*', 'multiply', [Prat.numerator, Krat.numerator])
            ]), true);

        let coeffs = phi.coefficients;
        postMessage({ success: true, roots: findRoots(coeffs) });
    } catch (error) {
        postMessage({ success: false, error: error.message });
    }
}
