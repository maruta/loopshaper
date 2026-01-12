// Main logic for loop shaping control design tool
// Core functions only - other functionality is in separate modules:
// - constants.js: Constants, display options, global state
// - layout.js: Dockview, panel management, resize observers
// - context-menu.js: All context menu functionality
// - sliders.js: Slider management
// - url-state.js: URL encoding, sharing, QR code
// - export.js: Code export (MATLAB/Python/Julia/Scilab)
// - pzmap.js: Pole-Zero Map drawing
// - step-response.js: Step response plotting

// ============================================================================
// System Analysis
// ============================================================================

// System analysis with lazy evaluation
// Only computes values when first accessed, then caches them
function createSystemAnalysis(L, Lrat) {
    const cache = {};

    const analysis = {
        // Raw inputs
        L: L,
        Lrat: Lrat,

        // Lazy-evaluated properties
        get lStructure() {
            if (!cache.lStructure) {
                cache.lStructure = analyzeLstructure(L);
            }
            return cache.lStructure;
        },

        get lCompiled() {
            if (!cache.lCompiled) {
                cache.lCompiled = L.compile();
            }
            return cache.lCompiled;
        },

        get imagAxisPoles() {
            if (!cache.hasOwnProperty('imagAxisPoles')) {
                const struct = this.lStructure;
                if (struct.type !== 'unknown' && struct.rationalPart) {
                    cache.imagAxisPoles = findImaginaryAxisPoles(struct.rationalPart);
                } else {
                    cache.imagAxisPoles = [];
                }
            }
            return cache.imagAxisPoles;
        },

        get rhpPoleCount() {
            if (!cache.hasOwnProperty('rhpPoleCount')) {
                const struct = this.lStructure;
                if (struct.type !== 'unknown' && struct.rationalPart) {
                    cache.rhpPoleCount = countRHPpoles(struct.rationalPart);
                } else {
                    cache.rhpPoleCount = null;
                }
            }
            return cache.rhpPoleCount;
        },

        get nyquistAnalysis() {
            if (!cache.hasOwnProperty('nyquistAnalysis')) {
                cache.nyquistAnalysis = getOrComputeNyquistAnalysisCached(
                    L, this.lCompiled, this.imagAxisPoles
                );
            }
            return cache.nyquistAnalysis;
        },

        get windingNumber() {
            const nyq = this.nyquistAnalysis;
            return nyq ? nyq.N : 0;
        },

        get isClosedLoopStable() {
            const P = this.rhpPoleCount;
            const N = this.windingNumber;
            if (P === null) return null;
            return (N + P === 0);
        },

        get stabilityMargins() {
            if (!cache.hasOwnProperty('stabilityMargins')) {
                cache.stabilityMargins = calculateStabilityMargins();
            }
            return cache.stabilityMargins;
        },

        // Open-loop poles and zeros (from Lrat or rationalPart)
        get openLoopPolesZeros() {
            if (!cache.hasOwnProperty('openLoopPolesZeros')) {
                let poles = [];
                let zeros = [];

                // Use Lrat if available, otherwise try rationalPart from structure
                let LratForPZ = Lrat;
                if (!LratForPZ) {
                    const struct = this.lStructure;
                    if (struct.rationalPart) {
                        try {
                            LratForPZ = util_rationalize(struct.rationalPart);
                        } catch (e) {
                            // Non-rationalizable expressions are handled gracefully
                        }
                    }
                }

                if (LratForPZ) {
                    // Get poles from denominator
                    try {
                        let denStr = LratForPZ.denominator.toString();
                        let denPoly = math.rationalize(denStr, true);
                        if (denPoly.coefficients && denPoly.coefficients.length > 1) {
                            let denRoots = findRoots(denPoly.coefficients);
                            poles = root2math(denRoots);
                        }
                    } catch (e) {
                        // Root finding may fail for some polynomials
                    }

                    // Get zeros from numerator
                    try {
                        let numStr = LratForPZ.numerator.toString();
                        let numPoly = math.rationalize(numStr, true);
                        if (numPoly.coefficients && numPoly.coefficients.length > 1) {
                            let numRoots = findRoots(numPoly.coefficients);
                            zeros = root2math(numRoots);
                        }
                    } catch (e) {
                        // Root finding may fail for some polynomials
                    }
                }

                cache.openLoopPolesZeros = { poles, zeros };
            }
            return cache.openLoopPolesZeros;
        },

        // Closed-loop poles and zeros
        get closedLoopPolesZeros() {
            if (!cache.hasOwnProperty('closedLoopPolesZeros')) {
                let poles = [];
                let zeros = [];

                const struct = this.lStructure;
                if (struct.type === 'rational' && Lrat) {
                    // Get characteristic polynomial: 1 + L = 0
                    try {
                        let charPolyNode = new math.OperatorNode('+', 'add',
                            [Lrat.denominator.clone(), Lrat.numerator.clone()]);
                        let charPolyStr = charPolyNode.toString();
                        let charPoly = math.rationalize(charPolyStr, true);

                        let coeffs = charPoly.coefficients;
                        if (coeffs && coeffs.length > 0) {
                            let roots = findRoots(coeffs);
                            poles = root2math(roots);
                        }
                    } catch (e) {
                        // Root finding may fail for some polynomials
                    }

                    // Calculate zeros from L's numerator
                    try {
                        let numStr = Lrat.numerator.toString();
                        let numPoly = math.rationalize(numStr, true);
                        if (numPoly.coefficients && numPoly.coefficients.length > 1) {
                            let numRoots = findRoots(numPoly.coefficients);
                            zeros = root2math(numRoots);
                        }
                    } catch (e) {
                        // Root finding may fail for some polynomials
                    }
                }

                cache.closedLoopPolesZeros = { poles, zeros };
            }
            return cache.closedLoopPolesZeros;
        },

        // For step response simulation
        get stepResponseData() {
            if (!cache.hasOwnProperty('stepResponseData')) {
                cache.stepResponseData = null;

                const struct = this.lStructure;
                if (struct.type === 'unknown') {
                    return cache.stepResponseData;
                }

                const delayL = struct.delayTime || 0;

                let LratSim = null;
                try {
                    LratSim = util_rationalize(struct.rationalPart);
                } catch (e) {
                    return cache.stepResponseData;
                }

                let LCoeffs = extractTFCoeffs(LratSim);
                if (!LCoeffs) {
                    return cache.stepResponseData;
                }

                cache.stepResponseData = {
                    type: struct.type,
                    delayL: delayL,
                    LCoeffs: LCoeffs,
                    ssL: tf2ss(LCoeffs.num, LCoeffs.den)
                };
            }
            return cache.stepResponseData;
        }
    };

    return analysis;
}

// ============================================================================
// Code Parsing
// ============================================================================

// Parse a single line of code, extracting variable name and expression
function parseCodeLine(line) {
    line = line.trim();
    if (line === '' || line.startsWith('#')) return null;

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) return null;

    const varName = line.substring(0, eqIndex).trim();
    let exprStr = line.substring(eqIndex + 1).trim();

    const commentIndex = exprStr.indexOf('#');
    if (commentIndex >= 0) {
        exprStr = exprStr.substring(0, commentIndex).trim();
    }

    if (!varName || !exprStr) return null;
    return { varName, exprStr };
}

// Process code lines and build variables object
function processCodeLines(code, vars, onError) {
    code.split('\n').forEach((line, lineNum) => {
        const parsed = parseCodeLine(line);
        if (!parsed) return;

        try {
            let expr = math.parse(parsed.exprStr);
            expr = expandPadeDelay(expr); // Expand pade_delay() to rational form
            const substituted = substituteVars(expr, vars);
            vars[parsed.varName] = substituted;
        } catch (e) {
            if (onError) onError({ line: lineNum + 1, message: e.message });
        }
    });
}

function substituteVars(expr, vars) {
    return expr.transform(function(node, path, parent) {
        if (node.isSymbolNode && node.name !== 's' && vars[node.name] !== undefined) {
            let val = vars[node.name];
            // If it's a number, create a constant node
            if (typeof val === 'number') {
                return new math.ConstantNode(val);
            }
            // If it's already a node, return it
            if (val.isNode) {
                return val.clone();
            }
            return node;
        }
        return node;
    });
}

// ============================================================================
// Main Update Function
// ============================================================================

function updateAll() {
    // Check if code has changed (need to recalculate symbolic expressions)
    const codeChanged = (cachedSymbolic.codeHash !== design.code);
    const parseErrors = [];

    // Parse code and extract variables
    try {
        currentVars = { s: math.parse('s') };

        // First, initialize variables from slider values
        design.sliders.forEach(slider => {
            if (slider.name && slider.currentValue !== undefined) {
                currentVars[slider.name] = slider.currentValue;
            }
        });

        // Only recalculate symbolic expressions if code changed
        if (codeChanged) {
            const symbolicVars = { s: math.parse('s') };
            design.sliders.forEach(slider => {
                if (slider.name) {
                    symbolicVars[slider.name] = math.parse(slider.name);
                }
            });

            processCodeLines(design.code, symbolicVars, (err) => parseErrors.push(err));

            // Cache symbolic expressions
            cachedSymbolic.codeHash = design.code;
            cachedSymbolic.Lsym = symbolicVars.L || null;

            // Pre-calculate rationalized symbolic expressions for display
            if (cachedSymbolic.Lsym && cachedSymbolic.Lsym.isNode) {
                try {
                    cachedSymbolic.LsymRat = util_rationalize(cachedSymbolic.Lsym);
                    const Tnum = math.simplify(cachedSymbolic.LsymRat.numerator);
                    const Tden = math.simplify(
                        new math.OperatorNode('+', 'add', [
                            cachedSymbolic.LsymRat.numerator.clone(),
                            cachedSymbolic.LsymRat.denominator.clone()
                        ])
                    );
                    cachedSymbolic.TsymSimplified = new math.OperatorNode('/', 'divide', [Tnum, Tden]);
                } catch (e) {
                    cachedSymbolic.LsymRat = null;
                    cachedSymbolic.TsymSimplified = null;
                }
            }
        }

        // Numerical calculation (always needed when sliders change)
        processCodeLines(design.code, currentVars, (err) => {
            // Only add if not already recorded (codeChanged handles symbolic errors)
            if (!codeChanged) parseErrors.push(err);
        });

        // Copy cached symbolic expressions to currentVars
        currentVars.Lsym = cachedSymbolic.Lsym;

        syncSlidersFromVars();

    } catch (e) {
        const codeField = document.getElementById('field-code');
        if (codeField) {
            codeField.classList.remove('is-valid');
            codeField.classList.add('is-invalid');
        }
        console.log('Parse error:', e);
        return;
    }

    // Check if L can be evaluated by substituting a test value for s
    let evaluationError = null;
    if (currentVars.L && currentVars.L.isNode) {
        try {
            let testResult = currentVars.L.compile().evaluate({ 's': math.complex(0, 1) });
            // Check if result is a valid number or complex
            if (testResult === undefined || testResult === null ||
                (typeof testResult === 'number' && !isFinite(testResult))) {
                evaluationError = 'L(s) evaluation returned invalid result';
            }
        } catch (e) {
            evaluationError = e.message;
        }
    }

    const prefix = isNarrowLayout ? 'narrow-' : '';
    const codeField = document.getElementById(prefix + 'field-code');
    const eqLDisplay = document.getElementById(prefix + 'eq-L-display');
    const eqTDisplay = document.getElementById(prefix + 'eq-T-display');

    // Check if L is defined and valid
    let hasErrors = parseErrors.length > 0 || evaluationError !== null;
    if (currentVars.L && !hasErrors) {
        if (codeField) {
            codeField.classList.remove('is-invalid');
            codeField.classList.add('is-valid');
        }
        // Calculate closed-loop TF first (sets currentVars.Lrat)
        calculateClosedLoopTF();
        // Create system analysis object with lazy evaluation
        currentVars.analysis = createSystemAnalysis(currentVars.L, currentVars.Lrat);
        displayTransferFunctions();

        // Always perform all calculations (lazy evaluation caching prevents redundant work)
        updateClosedLoopPoles();
        autoAdjustFrequencyRange();
        updateBodePlot();
        updateMargins();
        updateNyquistInfo();

        // Only skip plot rendering for hidden panels (drawing is expensive)
        if (isPlotVisible('pole-zero')) updatePolePlot();
        if (isPlotVisible('nyquist')) updateNyquistPlot();
        if (isPlotVisible('step-response')) updateStepResponsePlot();
    } else if (hasErrors) {
        // Show error state
        if (codeField) {
            codeField.classList.remove('is-valid');
            codeField.classList.add('is-invalid');
        }

        let errorMsg = '';
        if (parseErrors.length > 0) {
            errorMsg = 'Parse error at line ' + parseErrors[0].line + ': ' + parseErrors[0].message;
        } else if (evaluationError) {
            errorMsg = 'Evaluation error: ' + evaluationError;
        }
        if (eqLDisplay) {
            eqLDisplay.innerHTML = '<span class="text-danger">' + errorMsg + '</span>';
        }
        if (eqTDisplay) {
            eqTDisplay.innerHTML = '';
        }
    } else {
        // L not defined, but no errors
        if (codeField) {
            codeField.classList.remove('is-valid');
            codeField.classList.remove('is-invalid');
        }
        if (eqLDisplay) {
            eqLDisplay.innerHTML = '<span class="text-warning">Define L = ... to see the Bode plot</span>';
        }
        if (eqTDisplay) {
            eqTDisplay.innerHTML = '';
        }
    }

    updateBrowserUrl();
}

// ============================================================================
// Transfer Function Calculation and Display
// ============================================================================

function calculateClosedLoopTF() {
    // T and S calculation (for Bode plot and closed-loop poles)
    let L = currentVars.L;
    if (!L || !L.isNode) return;

    // Always create T = L / (1 + L) and S = 1 / (1 + L) symbolically
    // Works for any L including exp, sin, etc.
    let one = new math.ConstantNode(1);
    let onePlusL = new math.OperatorNode('+', 'add', [one, L.clone()]);
    let T = new math.OperatorNode('/', 'divide', [L.clone(), onePlusL]);
    let S = new math.OperatorNode('/', 'divide', [one.clone(), onePlusL.clone()]);
    currentVars.T = T;
    currentVars.S = S;

    // Try to rationalize L for pole-zero calculation (may fail for non-rational L)
    try {
        let Lrat = util_rationalize(L);
        currentVars.Lrat = Lrat;  // Store for closed-loop poles calculation
    } catch (e) {
        currentVars.Lrat = null;
        console.log('L is not a rational function, pole-zero calculation disabled:', e.message);
    }
}

function displayTransferFunctions() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let displayL = document.getElementById(prefix + 'eq-L-display');
    let displayT = document.getElementById(prefix + 'eq-T-display');

    if (!displayL || !displayT) return;

    try {
        // Display cached symbolic L
        let Lsym = cachedSymbolic.Lsym;
        if (Lsym && Lsym.isNode) {
            let texString = Lsym.toTex({ parenthesis: 'auto', implicit: 'hide' });
            katex.render('L(s) = ' + texString, displayL, { displayMode: true, throwOnError: false });
        } else {
            displayL.innerHTML = '<span class="text-muted">--</span>';
        }
    } catch (e) {
        displayL.innerHTML = '<span class="text-danger">Error displaying L(s)</span>';
        console.log('L display error:', e);
    }

    try {
        // Display T: use simplified form if available, otherwise show L/(1+L)
        let TsymSimplified = cachedSymbolic.TsymSimplified;
        if (TsymSimplified && TsymSimplified.isNode) {
            let texString = TsymSimplified.toTex({ parenthesis: 'auto', implicit: 'hide' });
            katex.render('T(s) = \\frac{L(s)}{1+L(s)} = ' + texString, displayT, { displayMode: true, throwOnError: false });
        } else if (cachedSymbolic.Lsym && cachedSymbolic.Lsym.isNode) {
            // L is not rational, just show T = L/(1+L) without simplification
            katex.render('T(s) = \\frac{L(s)}{1+L(s)}', displayT, { displayMode: true, throwOnError: false });
        } else {
            displayT.innerHTML = '<span class="text-muted">--</span>';
        }
    } catch (e) {
        displayT.innerHTML = '<span class="text-danger">Error displaying T(s)</span>';
        console.log('T display error:', e);
    }
}

// ============================================================================
// Stability Margins
// ============================================================================

// Calculate stability margins (gain margin and phase margin) independently of Bode plot.
// This allows the Stability panel to display correct values even when the Bode panel is hidden.
function calculateStabilityMargins() {
    let L = currentVars.L;
    if (!L || !L.isNode) return null;

    let compiled = L.compile();

    // Build frequency array, potentially including ω = 0
    let w = logspace(design.freqMin, design.freqMax, design.freqPoints);

    // Try to evaluate L(0) - if finite, include ω = 0 in the sweep
    // This catches crossovers at ω = 0 (e.g., L(s) = -1/(s+1) has phase = -180° at ω = 0)
    let includeZero = false;
    try {
        let L0 = compiled.evaluate({ 's': math.complex(0, 0) });
        if (typeof L0.abs === 'function') {
            let mag0 = L0.abs();
            if (isFinite(mag0) && mag0 > 0 && mag0 < 1e10) {
                includeZero = true;
            }
        } else if (typeof L0 === 'number' && isFinite(L0) && Math.abs(L0) > 0) {
            includeZero = true;
        }
    } catch (e) {
        // L(0) evaluation failed - probably has a pole at origin
    }

    if (includeZero) {
        w = [0, ...w];
    }

    let N = w.length;
    let gain = Array(N);
    let phase = Array(N);
    let phaseOffset = 0;

    for (let i = 0; i < N; i++) {
        let Gjw;
        try {
            Gjw = compiled.evaluate({ 's': math.complex(0, w[i]) });
        } catch (e) {
            Gjw = math.complex(0, 0);
        }
        if (typeof Gjw.abs !== 'function') Gjw = math.complex(Gjw, 0);

        gain[i] = 20 * math.log10(Gjw.abs());

        // Phase unwrapping
        let rawPhase = Gjw.arg() / math.pi * 180;
        if (i > 0 && Math.abs(rawPhase + phaseOffset - phase[i - 1]) > 180) {
            phaseOffset += Math.round(-(rawPhase + phaseOffset - phase[i - 1]) / 360) * 360;
        }
        phase[i] = rawPhase + phaseOffset;
    }

    // Detect crossover frequencies
    let wgc = [];  // Gain crossover (0 dB)
    let wpc = [];  // Phase crossover (-180 deg)

    // Check for exact crossover at ω = 0 (first point if included)
    // This handles cases like L(s) = -1/(s+1) where L(0) = -1 (gain = 0dB, phase = -180°)
    if (N > 0 && w[0] === 0) {
        // Check for gain crossover at ω = 0 (gain exactly 0 dB)
        if (Math.abs(gain[0]) < 0.01) {  // Within 0.01 dB of 0
            wgc.push(0);
        }
        // Check for phase crossover at ω = 0 (phase exactly -180° ± n×360°)
        let phaseRemainder = ((phase[0] + 180) % 360 + 360) % 360;  // Normalize to [0, 360)
        if (phaseRemainder < 1 || phaseRemainder > 359) {  // Within 1° of -180° ± n×360°
            wpc.push(0);
        }
    }

    for (let i = 1; i < N; i++) {
        // Gain crossover: detect when gain crosses 0 dB in either direction
        if ((gain[i - 1] > 0 && gain[i] <= 0) || (gain[i - 1] <= 0 && gain[i] > 0)) {
            let ratio = -gain[i - 1] / (gain[i] - gain[i - 1]);
            let wCross = w[i - 1] + ratio * (w[i] - w[i - 1]);
            // Avoid duplicate detection if we already added ω ≈ 0
            if (wCross > 1e-6 || !wgc.some(wc => Math.abs(wc - wCross) < 1e-6)) {
                wgc.push(wCross);
            }
        }

        // Phase crossover: detect when phase crosses -180° ± n×360°
        let p1 = phase[i - 1];
        let p2 = phase[i];
        let n1 = Math.floor((p1 + 180) / 360);
        let n2 = Math.floor((p2 + 180) / 360);
        if (n1 !== n2) {
            let targetPhase = (p1 > p2) ? n1 * 360 - 180 : n2 * 360 - 180;
            let ratio = (targetPhase - p1) / (p2 - p1);
            let wCross = w[i - 1] + ratio * (w[i] - w[i - 1]);
            // Avoid duplicate detection if we already added ω ≈ 0
            if (wCross > 1e-6 || !wpc.some(wc => Math.abs(wc - wCross) < 1e-6)) {
                wpc.push(wCross);
            }
        }
    }

    let gainMargins = [];
    let phaseMargins = [];

    // Gain margin: -gain at phase crossover frequency
    wpc.forEach((wc) => {
        for (let i = 0; i < N - 1; i++) {
            if (w[i] <= wc && w[i + 1] >= wc) {
                let ratio = (wc - w[i]) / (w[i + 1] - w[i]);
                let gainAtWpc = gain[i] + ratio * (gain[i + 1] - gain[i]);
                gainMargins.push({ frequency: wc, margin: -gainAtWpc, gainAtCrossover: gainAtWpc });
                break;
            }
        }
    });

    // Phase margin: phase + 180 at gain crossover frequency
    wgc.forEach((wc) => {
        for (let i = 0; i < N - 1; i++) {
            if (w[i] <= wc && w[i + 1] >= wc) {
                let ratio = (wc - w[i]) / (w[i + 1] - w[i]);
                let phaseAtGc = phase[i] + ratio * (phase[i + 1] - phase[i]);
                let n = Math.round((phaseAtGc + 180) / 360);
                let pm = 180 + phaseAtGc - n * 360;
                let refPhase = n * 360 - 180;
                phaseMargins.push({ frequency: wc, margin: pm, phaseAtCrossover: phaseAtGc, referencePhase: refPhase });
                break;
            }
        }
    });

    return { gainMargins, phaseMargins, gainCrossoverFrequencies: wgc, phaseCrossoverFrequencies: wpc };
}

// ============================================================================
// Bode Plot
// ============================================================================

function updateBodePlot() {
    try {
        let L = currentVars.L;
        let T = currentVars.T;
        let S = currentVars.S;
        if (!L || !L.isNode) return;

        // Generate frequency array
        let w = logspace(design.freqMin, design.freqMax, design.freqPoints);

        // Prepare transfer functions for plotting
        let transferFunctions = [
            {
                compiled: L.compile(),
                gainColor: CONSTANTS.COLORS.L,
                phaseColor: CONSTANTS.COLORS.L,
                visible: displayOptions.showL
            }
        ];

        if (T && T.isNode) {
            transferFunctions.push({
                compiled: T.compile(),
                gainColor: CONSTANTS.COLORS.T,
                phaseColor: CONSTANTS.COLORS.T,
                visible: displayOptions.showT
            });
        }

        if (S && S.isNode) {
            transferFunctions.push({
                compiled: S.compile(),
                gainColor: CONSTANTS.COLORS.S,
                phaseColor: CONSTANTS.COLORS.S,
                visible: displayOptions.showS
            });
        }

        const prefix = isNarrowLayout ? 'narrow-' : '';
        let margins = drawBodeMulti(transferFunctions, w, prefix + 'bode-wrapper', prefix + 'bode-canvas', {
            showMarginLines: bodeOptions.showMarginLines,
            showCrossoverLines: bodeOptions.showCrossoverLines,
            autoScaleVertical: bodeOptions.autoScaleVertical,
            gainMin: bodeOptions.gainMin,
            gainMax: bodeOptions.gainMax,
            phaseMin: bodeOptions.phaseMin,
            phaseMax: bodeOptions.phaseMax
        });

        // Cache margins from Bode plot (may be null if panel is hidden)
        if (margins) {
            window.lastMargins = margins;
        }

    } catch (e) {
        console.log('Bode plot error:', e);
    }
}

// ============================================================================
// Design Comparison Snapshots
// ============================================================================

// Lighten a hex color by mixing with white (factor: 0=original, 1=white)
function lightenColor(hex, factor = 0.5) {
    // Parse hex color
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Mix with white
    const newR = Math.round(r + (255 - r) * factor);
    const newG = Math.round(g + (255 - g) * factor);
    const newB = Math.round(b + (255 - b) * factor);
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

// Calculate frequency response for a compiled transfer function
function calculateFrequencyResponse(compiled, w) {
    const N = w.length;
    const gain = new Array(N);
    const phase = new Array(N);
    let phaseOffset = 0;

    for (let i = 0; i < N; i++) {
        let Gjw;
        try {
            Gjw = compiled.evaluate({ 's': math.complex(0, w[i]) });
        } catch (e) {
            Gjw = math.complex(0, 0);
        }
        if (typeof Gjw.abs !== 'function') Gjw = math.complex(Gjw, 0);

        gain[i] = 20 * math.log10(Gjw.abs());

        // Phase unwrapping
        let rawPhase = Gjw.arg() / math.pi * 180;
        if (i > 0 && Math.abs(rawPhase + phaseOffset - phase[i - 1]) > 180) {
            phaseOffset += Math.round(-(rawPhase + phaseOffset - phase[i - 1]) / 360) * 360;
        }
        phase[i] = rawPhase + phaseOffset;
    }

    return { gain, phase };
}

// Save current L(s), T(s), S(s) frequency response and step response as a snapshot
function saveCurrentAsSnapshot() {
    const L = currentVars.L;
    const T = currentVars.T;
    const S = currentVars.S;
    const analysis = currentVars.analysis;

    if (!L || !L.isNode) {
        showToast('No transfer function defined', 'warning');
        return;
    }

    // Check max snapshots
    if (savedSnapshots.length >= MAX_SNAPSHOTS) {
        showToast(`Maximum ${MAX_SNAPSHOTS} snapshots allowed. Clear existing snapshots first.`, 'warning');
        return;
    }

    // Generate frequency array for Bode
    const w = logspace(design.freqMin, design.freqMax, design.freqPoints);

    // Calculate frequency response for L
    const respL = calculateFrequencyResponse(L.compile(), w);

    // Calculate frequency response for T (if available)
    let respT = null;
    if (T && T.isNode) {
        respT = calculateFrequencyResponse(T.compile(), w);
    }

    // Calculate frequency response for S (if available)
    let respS = null;
    if (S && S.isNode) {
        respS = calculateFrequencyResponse(S.compile(), w);
    }

    // Get step response data (if available)
    let stepData = null;
    if (analysis && analysis.stepResponseData) {
        try {
            const stepTimeMax = typeof getStepTimeMax === 'function' ? getStepTimeMax() : 20;
            const structure = analysis.lStructure;
            const ssL = analysis.stepResponseData.ssL;
            const delayL = analysis.stepResponseData.delayL;
            const LCoeffs = analysis.stepResponseData.LCoeffs;

            let nPoints = 500;
            if (structure.type === 'rational_delay' && delayL > 0) {
                const dtTarget = delayL / 25;
                if (dtTarget > 0) {
                    nPoints = Math.max(nPoints, Math.ceil(stepTimeMax / dtTarget) + 1);
                }
                nPoints = Math.min(nPoints, 20000);
            }

            if (structure.type === 'rational_delay') {
                const simL = simulateStepResponse(ssL, null, stepTimeMax, nPoints, delayL, 0);
                const simT = simulateClosedLoopStepResponseLoopDelay(ssL, delayL, stepTimeMax, nPoints);
                stepData = { time: simL.time, yL: simL.yL, yT: simT.y };
            } else {
                // Build state-space for T
                let ssT = null;
                try {
                    const Tnum = LCoeffs.num.slice();
                    let Tden = [];
                    const maxLen = Math.max(LCoeffs.num.length, LCoeffs.den.length);
                    const numPadded = LCoeffs.num.slice();
                    const denPadded = LCoeffs.den.slice();
                    while (numPadded.length < maxLen) numPadded.push(0);
                    while (denPadded.length < maxLen) denPadded.push(0);
                    for (let i = 0; i < maxLen; i++) {
                        Tden.push(numPadded[i] + denPadded[i]);
                    }
                    while (Tden.length > 1 && Math.abs(Tden[Tden.length - 1]) < 1e-15) {
                        Tden.pop();
                    }
                    ssT = tf2ss(Tnum, Tden);
                } catch (e) {
                    // T state-space build failed
                }
                stepData = simulateStepResponse(ssL, ssT, stepTimeMax, nPoints, 0, 0);
            }
        } catch (e) {
            console.log('Snapshot: step response simulation failed:', e);
        }
    }

    // Generate name from current slider values
    const paramStr = design.sliders
        .map(s => `${s.name}=${s.currentValue.toPrecision(3)}`)
        .join(', ');

    savedSnapshots.push({
        name: paramStr || 'Snapshot ' + (savedSnapshots.length + 1),
        visible: true,
        bodeData: {
            frequencies: w,
            L: respL,
            T: respT,
            S: respS
        },
        stepData: stepData
    });

    updateSnapshotCountDisplay();
    showToast('Snapshot saved for comparison');
    updateBodePlot();
    updateStepResponsePlot();
}

// Clear all snapshots
function clearAllSnapshots() {
    if (savedSnapshots.length === 0) {
        showToast('No snapshots to clear', 'warning');
        return;
    }
    savedSnapshots.length = 0;
    updateSnapshotCountDisplay();
    showToast('All snapshots cleared');
    updateBodePlot();
    updateStepResponsePlot();
}

// Update the snapshot count display in Compare menu
function updateSnapshotCountDisplay() {
    const countEl = document.getElementById('compare-snapshot-count');
    if (countEl) {
        if (savedSnapshots.length === 0) {
            countEl.textContent = 'No saved references';
        } else {
            countEl.textContent = `${savedSnapshots.length} reference(s) saved`;
        }
    }
}

// Initialize Compare menu event handlers
function initializeCompareMenu() {
    const saveItem = document.getElementById('compare-save-snapshot');
    const clearItem = document.getElementById('compare-clear-snapshots');

    if (saveItem) {
        saveItem.addEventListener('click', () => {
            saveCurrentAsSnapshot();
        });
    }

    if (clearItem) {
        clearItem.addEventListener('click', () => {
            clearAllSnapshots();
        });
    }
}

// ============================================================================
// Nyquist Analysis Cache
// ============================================================================

function buildNyquistCacheKey(Lnode, imagAxisPoles) {
    const Lstr = (Lnode && typeof Lnode.toString === 'function') ? Lnode.toString() : '';
    const polesStr = (imagAxisPoles || [])
        .map(p => `${(p.re || 0).toFixed(12)},${(p.im || 0).toFixed(12)}`)
        .join(';');
    return Lstr + '|' + polesStr;
}

function getOrComputeNyquistAnalysisCached(Lnode, Lcompiled, imagAxisPoles) {
    if (typeof computeNyquistAnalysis !== 'function') return null;

    const key = buildNyquistCacheKey(Lnode, imagAxisPoles);
    if (window.lastNyquistAnalysis && window.lastNyquistAnalysisKey === key) {
        return window.lastNyquistAnalysis;
    }

    const analysis = computeNyquistAnalysis(Lcompiled, imagAxisPoles, {
        wMinDecade: -4,
        wMaxDecade: 6,
        wPoints: 1000,
        nIndentPoints: 50,
        epsilon: 1e-4
    });

    window.lastNyquistAnalysis = analysis;
    window.lastNyquistAnalysisKey = key;

    return analysis;
}

// ============================================================================
// Closed-Loop Poles
// ============================================================================

function updateClosedLoopPoles() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let clpEl = document.getElementById(prefix + 'clp-display');
    let indicator = document.getElementById(prefix + 'stability-indicator');

    try {
        const analysis = currentVars.analysis;
        if (!analysis) {
            if (clpEl) clpEl.textContent = '--';
            if (indicator) {
                indicator.textContent = '--';
                indicator.variant = 'neutral';
            }
            window.lastPoles = [];
            window.lastZeros = [];
            updateTpzCheckboxState(false);
            return;
        }

        const structure = analysis.lStructure;
        if (structure.type === 'unknown') {
            if (clpEl) clpEl.textContent = '--';
            if (indicator) {
                indicator.textContent = '--';
                indicator.variant = 'neutral';
            }
            window.lastPoles = [];
            window.lastZeros = [];
            updateTpzCheckboxState(false);
            return;
        }

        // Get Nyquist analysis results (uses lazy evaluation with caching)
        const P = analysis.rhpPoleCount;
        const N = analysis.windingNumber;
        window.lastNyquistP = P;
        window.lastNyquistN = N;

        // Determine stability using Nyquist criterion: Z = N + P
        const Z = (P !== null) ? N + P : null;
        const isStable = (Z !== null) ? (Z === 0) : false;

        if (structure.type === 'rational') {
            const clPZ = analysis.closedLoopPolesZeros;
            if (clPZ.poles.length > 0) {
                displayClosedLoopPoles(clPZ.poles, isStable);
            } else {
                if (clpEl) clpEl.textContent = 'No poles';
                updateStabilityIndicator(isStable);
                window.lastPoles = [];
            }
            window.lastZeros = clPZ.zeros;
        } else {
            // For rational_delay, show Nyquist-based stability
            if (P === null) {
                if (clpEl) clpEl.textContent = '--';
                if (indicator) {
                    indicator.textContent = '--';
                    indicator.variant = 'neutral';
                }
                window.lastPoles = [];
                window.lastZeros = [];
                return;
            }

            if (clpEl) {
                clpEl.textContent = isStable ? '(Nyquist stable)' : `(${Z} RHP poles)`;
                clpEl.classList.remove('text-danger', 'text-muted');
            }
            updateStabilityIndicator(isStable);
            window.lastPoles = [];
            window.lastZeros = [];
        }

        // Update T(s) checkbox enabled state based on structure type
        updateTpzCheckboxState(structure.type === 'rational');

    } catch (e) {
        console.log('CLP error:', e);
        if (clpEl) {
            clpEl.textContent = 'Error: ' + e.message;
            clpEl.classList.add('text-danger');
            clpEl.classList.remove('text-muted');
        }
        if (indicator) {
            indicator.textContent = '--';
            indicator.variant = 'neutral';
        }
        window.lastPoles = [];
        window.lastZeros = [];
        updateTpzCheckboxState(false);
    }
}

function updateStabilityIndicator(isStable) {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let indicator = document.getElementById(prefix + 'stability-indicator');
    if (!indicator) return;

    // Shoelace sl-badge uses 'variant' attribute
    if (isStable) {
        indicator.textContent = 'Stable';
        indicator.variant = 'success';
    } else {
        indicator.textContent = 'Unstable';
        indicator.variant = 'danger';
    }
}

function updateTpzCheckboxState(enabled) {
    // Update T(s) checkbox enabled state in both layouts
    const chkTpz = document.getElementById('chk-show-T-pz');
    const narrowChkTpz = document.getElementById('narrow-chk-show-T-pz');

    function updateCheckbox(checkbox) {
        if (!checkbox) return;
        // Wait for Shoelace component to be ready if needed
        if (checkbox.updateComplete) {
            checkbox.updateComplete.then(() => {
                checkbox.disabled = !enabled;
                if (!enabled) {
                    checkbox.checked = false;
                }
            });
        } else {
            checkbox.disabled = !enabled;
            if (!enabled) {
                checkbox.checked = false;
            }
        }
    }

    updateCheckbox(chkTpz);
    updateCheckbox(narrowChkTpz);

    if (!enabled) {
        displayOptions.showTpz = false;
    }
}

function displayClosedLoopPoles(poles, isStableByNyquist) {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let clpEl = document.getElementById(prefix + 'clp-display');

    // Handle empty poles case
    if (!poles || poles.length === 0) {
        if (clpEl) {
            clpEl.textContent = 'No poles';
            clpEl.classList.add('text-muted');
            clpEl.classList.remove('text-danger');
        }
        updateStabilityIndicator(isStableByNyquist);
        window.lastPoles = [];
        return;
    }

    let poleStrings = [];

    for (let i = 0; i < poles.length; i++) {
        let p = poles[i];
        let poleStr = '';
        let isUnstablePole = p.re > 1e-10;

        if (isUnstablePole) {
            poleStr = '\\color{red}{';
        }

        // Check for conjugate pairs
        if (i < poles.length - 1 &&
            Math.abs(p.re - poles[i + 1].re) < 1e-6 &&
            Math.abs(p.im + poles[i + 1].im) < 1e-6 &&
            Math.abs(p.im) > 1e-6) {
            poleStr += num2tex(p.re, 3) + ' \\pm ' + num2tex(Math.abs(p.im), 3) + 'j';
            i++;
        } else if (Math.abs(p.im) < 1e-6) {
            poleStr += num2tex(p.re, 3);
        } else {
            poleStr += num2tex(p.re, 3) + (p.im >= 0 ? '+' : '') + num2tex(p.im, 3) + 'j';
        }

        if (isUnstablePole) {
            poleStr += '}';
        }

        poleStrings.push(poleStr);
    }

    // Store poles for use by Pole-Zero Map (even if Stability panel is hidden)
    window.lastPoles = poles;

    // Update Stability panel display if visible
    if (clpEl) {
        let latex = poleStrings.join(',\\; ');
        clpEl.classList.remove('text-danger', 'text-muted');
        katex.render(latex, clpEl, {
            displayMode: false,
            throwOnError: false
        });
    }

    // Use Nyquist-based stability determination
    updateStabilityIndicator(isStableByNyquist);
}

// ============================================================================
// Nyquist Plot
// ============================================================================

// Unified Nyquist mapping formula update function
function updateNyquistMappingFormula(elementId) {
    const formulaEl = document.getElementById(elementId);
    if (!formulaEl) return;

    const R = nyquistCompressionRadius;
    const RStr = R % 1 === 0 ? R.toFixed(0) : R.toFixed(1);

    try {
        katex.render(
            `z \\mapsto \\frac{z}{1 + |z|/${RStr}}`,
            formulaEl,
            { throwOnError: false, displayMode: false }
        );
    } catch (e) {
        formulaEl.textContent = `z \u2192 z/(1+|z|/${RStr})`;
    }
}

// Unified Nyquist plot rendering function
function renderNyquistPlot(wrapperId, canvasId, formulaElementId) {
    const wrapper = document.getElementById(wrapperId);
    const canvas = document.getElementById(canvasId);

    if (!wrapper || !canvas) return;

    // Update the mapping formula display with current R value
    updateNyquistMappingFormula(formulaElementId);

    const L = currentVars.L;
    if (!L || !L.isNode) {
        // Clear canvas if L is not defined
        const ctx = canvas.getContext('2d');
        const width = wrapper.clientWidth;
        const height = wrapper.clientHeight;
        if (width === 0 || height === 0) return;
        canvas.width = width * devicePixelRatio;
        canvas.height = height * devicePixelRatio;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.scale(devicePixelRatio, devicePixelRatio);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        return;
    }

    try {
        const analysis = currentVars.analysis;
        if (!analysis) return;

        // Get stability margins for display (only if enabled and closed-loop is stable)
        let phaseMargins = null;
        let gainMargins = null;
        if (nyquistOptions.showStabilityMargin && analysis.isClosedLoopStable) {
            const margins = analysis.stabilityMargins;
            if (margins) {
                phaseMargins = margins.phaseMargins;
                gainMargins = margins.gainMargins;
            }
        }

        drawNyquist(analysis.lCompiled, analysis.imagAxisPoles, {
            wrapperId: wrapperId,
            canvasId: canvasId,
            animate: true,
            analysis: analysis.nyquistAnalysis,
            phaseMargins: phaseMargins,
            showPhaseMarginArc: nyquistOptions.showStabilityMargin,
            gainMargins: gainMargins,
            showGainMarginLine: nyquistOptions.showStabilityMargin
        });
    } catch (e) {
        console.log('Nyquist plot error:', e);
    }
}

function updateNyquistPlot() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    renderNyquistPlot(
        prefix + 'nyquist-wrapper',
        prefix + 'nyquist-canvas',
        prefix + 'nyquist-mapping-formula'
    );
}

// ============================================================================
// Margins Display
// ============================================================================

// Update stability margin display in Stability panel
function updateMargins() {
    const analysis = currentVars.analysis;
    if (!analysis) return;

    const margins = analysis.stabilityMargins;
    if (!margins) return;
    window.lastMargins = margins;

    const prefix = isNarrowLayout ? 'narrow-' : '';
    let gmDisplay = document.getElementById(prefix + 'gm-display');
    let pmDisplay = document.getElementById(prefix + 'pm-display');

    if (!gmDisplay || !pmDisplay) return;

    // Determine closed-loop stability from analysis
    const isClosedLoopStable = analysis.isClosedLoopStable || false;

    // Helper function to format margin list
    function formatMarginList(marginList, unit, formatMargin, formatFreq) {
        if (marginList.length === 0) return null;

        // Sort: stable -> by margin ascending, unstable -> by frequency ascending
        let sorted;
        if (isClosedLoopStable) {
            sorted = [...marginList].sort((a, b) => a.margin - b.margin);
        } else {
            sorted = [...marginList].sort((a, b) => a.frequency - b.frequency);
        }

        // Take up to 3
        let display = sorted.slice(0, 3);
        let hasMore = sorted.length > 3;

        let parts = display.map(m => formatMargin(m.margin) + ' ' + unit + ' @ ' + formatFreq(m.frequency) + ' rad/s');
        let result = parts.join(', ');
        if (hasMore) {
            result += ', …';
        }
        return result;
    }

    // Color based on closed-loop stability (not individual margin signs)
    const colorClass = isClosedLoopStable ? 'text-success' : 'text-danger';

    // Gain margin display
    if (margins.gainMargins.length > 0) {
        let gmStr = formatMarginList(
            margins.gainMargins,
            'dB',
            (m) => m.toFixed(2),
            (f) => f.toFixed(3)
        );
        gmDisplay.textContent = gmStr;
        gmDisplay.className = colorClass;
    } else {
        gmDisplay.textContent = '∞';
        gmDisplay.className = colorClass;
    }

    // Phase margin display
    if (margins.phaseMargins.length > 0) {
        let pmStr = formatMarginList(
            margins.phaseMargins,
            'deg',
            (m) => m.toFixed(2),
            (f) => f.toFixed(3)
        );
        pmDisplay.textContent = pmStr;
        pmDisplay.className = colorClass;
    } else {
        pmDisplay.textContent = 'N/A';
        pmDisplay.className = 'text-muted';
    }
}

function updateNyquistInfo() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let openLoopDisplay = document.getElementById(prefix + 'open-loop-unstable-display');
    let windingDisplay = document.getElementById(prefix + 'winding-number-display');

    // If elements not found, exit silently
    if (!openLoopDisplay || !windingDisplay) {
        return;
    }

    const analysis = currentVars.analysis;
    if (!analysis) {
        openLoopDisplay.textContent = '--';
        openLoopDisplay.className = 'text-muted';
        windingDisplay.textContent = '--';
        windingDisplay.className = 'text-muted';
        return;
    }

    try {
        const structure = analysis.lStructure;
        if (structure.type === 'unknown' || !structure.rationalPart) {
            openLoopDisplay.textContent = '--';
            openLoopDisplay.className = 'text-muted';
            windingDisplay.textContent = '--';
            windingDisplay.className = 'text-muted';
            return;
        }

        const P = analysis.rhpPoleCount;
        if (P === null) {
            openLoopDisplay.textContent = '--';
            openLoopDisplay.className = 'text-muted';
            windingDisplay.textContent = '--';
            windingDisplay.className = 'text-muted';
            return;
        }

        const N = analysis.windingNumber;

        // Display P (number of unstable open-loop poles)
        openLoopDisplay.textContent = P.toString();
        openLoopDisplay.className = P === 0 ? 'text-success' : 'text-warning';

        // Display N (winding number)
        windingDisplay.textContent = N.toString();
        const Z = N + P;
        windingDisplay.className = (Z === 0) ? 'text-success' : 'text-danger';

    } catch (e) {
        console.log('Nyquist info error:', e);
        openLoopDisplay.textContent = '--';
        openLoopDisplay.className = 'text-muted';
        windingDisplay.textContent = '--';
        windingDisplay.className = 'text-muted';
    }
}

// ============================================================================
// Auto Frequency Range
// ============================================================================

function autoAdjustFrequencyRange() {
    if (!autoFreq) return;

    try {
        let L = currentVars.L;
        if (!L || !L.isNode) {
            return;
        }

        // Rationalize L to get numerator and denominator
        let Lrat = util_rationalize(L);
        if (!Lrat) {
            return;
        }

        // Get poles from denominator and zeros from numerator
        let poles = [];
        let zeros = [];

        // Get denominator coefficients for poles
        try {
            let denStr = Lrat.denominator.toString();
            let denPoly = math.rationalize(denStr, true);
            if (denPoly.coefficients && denPoly.coefficients.length > 1) {
                let denRoots = findRoots(denPoly.coefficients);
                poles = root2math(denRoots);
            }
        } catch (e) {
            // Root finding may fail for some polynomials
        }

        // Get numerator coefficients for zeros
        try {
            let numStr = Lrat.numerator.toString();
            let numPoly = math.rationalize(numStr, true);
            if (numPoly.coefficients && numPoly.coefficients.length > 1) {
                let numRoots = findRoots(numPoly.coefficients);
                zeros = root2math(numRoots);
            }
        } catch (e) {
            // Root finding may fail for some polynomials
        }

        // Also get closed-loop poles (roots of 1+L)
        let closedLoopPoles = [];
        try {
            let clPoles = window.lastPoles || [];
            closedLoopPoles = clPoles.map(p => ({ re: p.re, im: p.im }));
        } catch (e) {
            // Gracefully handle missing pole data
        }

        // Combine open-loop poles, zeros, and closed-loop poles
        let allRoots = [...poles, ...zeros, ...closedLoopPoles];
        let frequencies = allRoots
            .map(p => Math.sqrt(p.re * p.re + p.im * p.im))  // absolute value
            .filter(f => f > 1e-6);  // exclude near-zero

        if (frequencies.length === 0) {
            // Default range if no poles/zeros found
            design.freqMin = -2;
            design.freqMax = 3;
        } else {
            let minFreq = Math.min(...frequencies);
            let maxFreq = Math.max(...frequencies);

            // Calculate center frequency (geometric mean in log scale)
            let logMin = Math.log10(minFreq);
            let logMax = Math.log10(maxFreq);
            let logSpan = logMax - logMin;

            // Set range with margin proportional to the spread
            // Minimum 0.5 decade margin on each side, plus ensure at least 3 decades total
            let margin = Math.max(0.5, (3 - logSpan) / 2);
            design.freqMin = logMin - margin;
            design.freqMax = logMax + margin;

            // Ensure minimum range of 3 decades
            if (design.freqMax - design.freqMin < 3) {
                let center = (logMin + logMax) / 2;
                design.freqMin = center - 1.5;
                design.freqMax = center + 1.5;
            }
        }

    } catch (e) {
        console.log('Auto frequency range error:', e);
    }
}

// ============================================================================
// UI Initialization
// ============================================================================

function initializeUI() {
    // Get element IDs based on layout mode
    const prefix = isNarrowLayout ? 'narrow-' : '';

    const codeField = document.getElementById(prefix + 'field-code');
    if (codeField) {
        // Shoelace sl-textarea uses 'value' property
        codeField.value = design.code;
    }

    // Apply auto frequency range setting
    autoFreq = design.autoFreq !== undefined ? design.autoFreq : true;

    // Wide layout only settings
    if (!isNarrowLayout) {
        // Apply Pole-Zero Map visibility settings
        displayOptions.showLpz = design.showLpz !== undefined ? design.showLpz : true;
        displayOptions.showTpz = design.showTpz !== undefined ? design.showTpz : true;
        const chkLpz = document.getElementById('chk-show-L-pz');
        const chkTpz = document.getElementById('chk-show-T-pz');
        if (chkLpz) chkLpz.checked = displayOptions.showLpz;
        if (chkTpz) chkTpz.checked = displayOptions.showTpz;
    }

    rebuildSliders();

    // Apply Bode plot visibility settings
    displayOptions.showL = design.showL !== undefined ? design.showL : true;
    displayOptions.showT = design.showT !== undefined ? design.showT : true;
    displayOptions.showS = design.showS !== undefined ? design.showS : false;
    const chkL = document.getElementById(prefix + 'chk-show-L');
    const chkT = document.getElementById(prefix + 'chk-show-T');
    const chkS = document.getElementById(prefix + 'chk-show-S');
    // Shoelace sl-checkbox uses 'checked' property
    if (chkL) chkL.checked = displayOptions.showL;
    if (chkT) chkT.checked = displayOptions.showT;
    if (chkS) chkS.checked = displayOptions.showS;
}

// ============================================================================
// Event Listeners
// ============================================================================

function debounceUpdate() {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }
    updateTimeout = setTimeout(function() {
        saveDesign();
        updateAll();
    }, CONSTANTS.DEBOUNCE_DELAY);
}

function saveDesign() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const codeField = document.getElementById(prefix + 'field-code');

    if (codeField) design.code = codeField.value;
}

function setupEventListeners() {
    const prefix = isNarrowLayout ? 'narrow-' : '';

    // Code field and add slider button
    attachListenerOnce(
        document.getElementById(prefix + 'field-code'),
        'sl-input',
        debounceUpdate
    );
    attachListenerOnce(
        document.getElementById(prefix + 'btn-add-slider'),
        'click',
        addSlider
    );

    // Bode plot visibility checkboxes
    attachListenerOnce(
        document.getElementById(prefix + 'chk-show-L'),
        'sl-change',
        function() {
            displayOptions.showL = this.checked;
            design.showL = displayOptions.showL;
            updateBodePlot();
            updateBrowserUrl();
        }
    );
    attachListenerOnce(
        document.getElementById(prefix + 'chk-show-T'),
        'sl-change',
        function() {
            displayOptions.showT = this.checked;
            design.showT = displayOptions.showT;
            updateBodePlot();
            updateBrowserUrl();
        }
    );
    attachListenerOnce(
        document.getElementById(prefix + 'chk-show-S'),
        'sl-change',
        function() {
            displayOptions.showS = this.checked;
            design.showS = displayOptions.showS;
            updateBodePlot();
            updateBrowserUrl();
        }
    );

    // Wide layout only elements
    if (!isNarrowLayout) {
        // Pole-Zero Map visibility checkboxes
        attachListenerOnce(
            document.getElementById('chk-show-L-pz'),
            'sl-change',
            function() {
                displayOptions.showLpz = this.checked;
                design.showLpz = displayOptions.showLpz;
                updatePolePlot();
            }
        );
        attachListenerOnce(
            document.getElementById('chk-show-T-pz'),
            'sl-change',
            function() {
                displayOptions.showTpz = this.checked;
                design.showTpz = displayOptions.showTpz;
                updatePolePlot();
            }
        );

        // Nyquist plot mouse wheel for compression radius
        attachListenerOnce(
            document.getElementById('nyquist-wrapper'),
            'wheel',
            function(e) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.5 : 0.5;
                nyquistCompressionRadius = Math.max(0.5, Math.min(100, nyquistCompressionRadius + delta));
                updateNyquistPlot();
            },
            '',
            { passive: false }
        );

        // Step Response visibility checkboxes
        attachListenerOnce(
            document.getElementById('chk-show-L-step'),
            'sl-change',
            function() {
                displayOptions.showLstep = this.checked;
                updateStepResponsePlot();
            }
        );
        attachListenerOnce(
            document.getElementById('chk-show-T-step'),
            'sl-change',
            function() {
                displayOptions.showTstep = this.checked;
                updateStepResponsePlot();
            }
        );
    }

    // Handle layout mode switching on window resize
    if (!resizeListenerAttached) {
        window.addEventListener('resize', function() {
            const newIsNarrow = window.innerWidth < CONSTANTS.NARROW_BREAKPOINT;
            if (newIsNarrow === isNarrowLayout) return;
            isNarrowLayout = newIsNarrow;

            if (isNarrowLayout) {
                initializeNarrowLayout();
            } else if (!dockviewApi) {
                initializeDockview();
                initializeViewMenu();
            }

            setupPlotResizeObserver();
            initializeUI();
            setupEventListeners();
            updateAll();
        });
        resizeListenerAttached = true;
    }

    setupBodeContextMenu();
    setupStepContextMenu();
    setupPzmapContextMenu();
    setupNyquistContextMenu();
}

// ============================================================================
// Initialization
// ============================================================================

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadFromUrl();

    isNarrowLayout = window.innerWidth < CONSTANTS.NARROW_BREAKPOINT;

    // Initialize Share menu (available on all layouts)
    initializeShareMenu();

    // Initialize Compare menu (available on all layouts)
    initializeCompareMenu();

    // Initialize Export dialog (available on all layouts)
    initializeExportDialog();

    if (isNarrowLayout) {
        // Narrow layout: use static HTML layout (no Dockview)
        initializeNarrowLayout();
    } else {
        // Wide layout: use Dockview
        initializeDockview();
        initializeViewMenu();
    }

    // Wait for panels to be rendered and Shoelace components to be ready
    Promise.all([
        customElements.whenDefined('sl-checkbox'),
        new Promise(resolve => setTimeout(resolve, 100))
    ]).then(() => {
        initializeUI();
        setupEventListeners();
        updateAll();

        // Enable and trigger browser URL synchronization
        isInitialized = true;
        updateBrowserUrl();
    });
});
