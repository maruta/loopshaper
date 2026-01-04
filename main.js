// Main logic for loop shaping control design tool

// Default design
let design = {
    code: `K = Kp*(1 + Td*s)
P = 1/(s*s*(s + 1))
L = K * P`,
    sliders: [
        { name: 'Kp', min: 0.01, max: 10, logScale: true, currentValue: 1 },
        { name: 'Td', min: 0.1, max: 100, logScale: true, currentValue: 10 }
    ],
    freqMin: -2,
    freqMax: 3,
    freqPoints: 200,
    showL: true,
    showT: true,
    autoFreq: true,
    layout: {
        leftPanelWidth: 350
    },
    collapsed: {}  // Track collapsed state of panels
};

let currentVars = {};
let updateTimeout = null;
let urlUpdateTimeout = null;
let showL = true;
let showT = true;
let autoFreq = true;

// Cached symbolic expressions (only recalculated when code changes)
let cachedSymbolic = {
    Lsym: null,
    LsymRat: null,  // Rationalized Lsym for T display
    TsymSimplified: null,
    codeHash: null
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadFromUrl();
    initializeUI();
    setupEventListeners();
    updateAll();

    // Render KaTeX math in labels
    renderMathInElement(document.body, {
        delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false}
        ],
        throwOnError: false
    });
});

function initializeUI() {
    document.getElementById('field-code').value = design.code;
    document.getElementById('field-freq-min').value = design.freqMin;
    document.getElementById('field-freq-max').value = design.freqMax;
    rebuildSliders();

    // Apply Bode plot visibility settings
    showL = design.showL !== undefined ? design.showL : true;
    showT = design.showT !== undefined ? design.showT : true;
    document.getElementById('chk-show-L').checked = showL;
    document.getElementById('chk-show-T').checked = showT;

    // Apply auto frequency range setting
    autoFreq = design.autoFreq !== undefined ? design.autoFreq : true;
    document.getElementById('chk-freq-auto').checked = autoFreq;
    document.getElementById('field-freq-min').disabled = autoFreq;
    document.getElementById('field-freq-max').disabled = autoFreq;

    // Apply layout settings (only leftPanelWidth; bodeHeight uses CSS default)
    if (design.layout && design.layout.leftPanelWidth) {
        document.getElementById('left-panel').style.width = design.layout.leftPanelWidth + 'px';
    }

    // Apply collapsed state for panels
    if (design.collapsed) {
        Object.keys(design.collapsed).forEach(panelId => {
            if (design.collapsed[panelId]) {
                const target = document.getElementById(panelId);
                const header = document.querySelector(`[data-target="#${panelId}"]`);
                if (target && header) {
                    target.classList.remove('show');
                    header.classList.add('collapsed');
                }
            }
        });
    }
}

function setupEventListeners() {
    document.getElementById('field-code').addEventListener('input', debounceUpdate);
    document.getElementById('field-freq-min').addEventListener('input', debounceUpdate);
    document.getElementById('field-freq-max').addEventListener('input', debounceUpdate);
    document.getElementById('btn-add-slider').addEventListener('click', addSlider);

    // Bode plot visibility checkboxes
    document.getElementById('chk-show-L').addEventListener('change', function() {
        showL = this.checked;
        design.showL = showL;
        updateBodePlot();
        debouncedSaveToUrl();
    });
    document.getElementById('chk-show-T').addEventListener('change', function() {
        showT = this.checked;
        design.showT = showT;
        updateBodePlot();
        debouncedSaveToUrl();
    });

    // Auto frequency range checkbox
    document.getElementById('chk-freq-auto').addEventListener('change', function() {
        autoFreq = this.checked;
        design.autoFreq = autoFreq;
        document.getElementById('field-freq-min').disabled = autoFreq;
        document.getElementById('field-freq-max').disabled = autoFreq;
        if (autoFreq) {
            autoAdjustFrequencyRange();
        }
        updateAll();
    });

    window.addEventListener('resize', function() {
        updateBodePlot();
        updatePolePlot();
    });

    // Collapse toggle - manual handling to prevent interactive elements from triggering
    document.querySelectorAll('.collapsible').forEach(header => {
        const target = document.querySelector(header.dataset.target);
        if (!target) return;

        const panelId = target.id;

        // Track collapse state for icon and save to design
        target.addEventListener('hide.bs.collapse', () => {
            header.classList.add('collapsed');
            design.collapsed[panelId] = true;
            debouncedSaveToUrl();
        });
        target.addEventListener('show.bs.collapse', () => {
            header.classList.remove('collapsed');
            design.collapsed[panelId] = false;
            debouncedSaveToUrl();
        });

        // Manual click handler - only toggle if not clicking interactive elements
        header.addEventListener('click', e => {
            // Check if clicked on or inside an interactive element
            const interactive = e.target.closest('button, input, label, .badge, .form-check');
            if (interactive) {
                return; // Don't toggle collapse
            }
            // Toggle collapse using Bootstrap API
            const bsCollapse = bootstrap.Collapse.getOrCreateInstance(target, { toggle: false });
            bsCollapse.toggle();
        });
    });

    // Setup resize handles
    setupResizeHandles();
}

function setupResizeHandles() {
    const resizeHandleV = document.getElementById('resize-handle-v');
    const resizeHandleH = document.getElementById('resize-handle-h');
    const leftPanel = document.getElementById('left-panel');
    const bodeWrapper = document.getElementById('bode-wrapper');

    // Vertical resize (left/right panel ratio)
    let isResizingV = false;
    resizeHandleV.addEventListener('mousedown', function(e) {
        isResizingV = true;
        document.body.classList.add('resizing');
        resizeHandleV.classList.add('dragging');
        e.preventDefault();
    });

    // Horizontal resize (Bode plot height)
    let isResizingH = false;
    resizeHandleH.addEventListener('mousedown', function(e) {
        isResizingH = true;
        document.body.classList.add('resizing');
        resizeHandleH.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (isResizingV) {
            const containerRect = document.querySelector('.main-container').getBoundingClientRect();
            let newWidth = e.clientX - containerRect.left - 8; // 8px padding
            newWidth = Math.max(250, Math.min(600, newWidth));
            leftPanel.style.width = newWidth + 'px';
            design.layout.leftPanelWidth = newWidth;
        }

        if (isResizingH) {
            const bodeCard = bodeWrapper.closest('.card');
            const cardRect = bodeCard.getBoundingClientRect();
            const headerHeight = bodeCard.querySelector('.card-header').offsetHeight;
            let newHeight = e.clientY - cardRect.top - headerHeight;
            newHeight = Math.max(200, Math.min(800, newHeight));
            bodeWrapper.style.height = newHeight + 'px';
            design.layout.bodeHeight = newHeight;
        }
    });

    document.addEventListener('mouseup', function() {
        if (isResizingV || isResizingH) {
            isResizingV = false;
            isResizingH = false;
            document.body.classList.remove('resizing');
            resizeHandleV.classList.remove('dragging');
            resizeHandleH.classList.remove('dragging');
            updateBodePlot();
            updatePolePlot();
            debouncedSaveToUrl();
        }
    });
}

function debounceUpdate() {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }
    updateTimeout = setTimeout(function() {
        saveDesign();
        updateAll();
    }, 300);
}

function saveDesign() {
    design.code = document.getElementById('field-code').value;
    design.freqMin = parseFloat(document.getElementById('field-freq-min').value) || -2;
    design.freqMax = parseFloat(document.getElementById('field-freq-max').value) || 3;
}

function rebuildSliders() {
    let container = document.getElementById('sliders-container');
    container.innerHTML = '';

    design.sliders.forEach((slider, index) => {
        let div = createSliderElement(slider, index);
        container.appendChild(div);
    });
}

function createSliderElement(slider, index) {
    let div = document.createElement('div');
    div.className = 'slider-row';
    div.id = 'slider-row-' + index;

    let initialValue = slider.currentValue !== undefined ? slider.currentValue : slider.min;
    let initialPos = valueToSliderPos(initialValue, slider.min, slider.max, slider.logScale);

    div.innerHTML = `
        <div class="slider-config">
            <input type="text" class="form-control slider-name" placeholder="Name" value="${slider.name || ''}" data-index="${index}">
            <input type="number" class="form-control slider-min" placeholder="Min" value="${slider.min || 0.1}" step="any" data-index="${index}">
            <input type="number" class="form-control slider-max" placeholder="Max" value="${slider.max || 100}" step="any" data-index="${index}">
            <div class="form-check">
                <input type="checkbox" class="form-check-input slider-log" id="log-${index}" ${slider.logScale ? 'checked' : ''} data-index="${index}">
                <label class="form-check-label" for="log-${index}">Log</label>
            </div>
            <button class="btn btn-sm btn-danger remove-slider" data-index="${index}">&times;</button>
        </div>
        <div class="slider-control">
            <input type="range" class="form-range slider-range" id="range-${index}" min="0" max="1000" value="${initialPos}" data-index="${index}">
            <span class="slider-value" id="value-${index}">${formatValue(initialValue)}</span>
        </div>
    `;

    setTimeout(() => {
        let nameInput = div.querySelector('.slider-name');
        let minInput = div.querySelector('.slider-min');
        let maxInput = div.querySelector('.slider-max');
        let logCheck = div.querySelector('.slider-log');
        let rangeInput = div.querySelector('.slider-range');
        let removeBtn = div.querySelector('.remove-slider');

        nameInput.addEventListener('input', function() {
            design.sliders[index].name = this.value;
            updateCodeFromSliders();
            debounceUpdate();
        });

        minInput.addEventListener('input', function() {
            design.sliders[index].min = parseFloat(this.value) || 0.1;
            updateSliderValue(index);
        });

        maxInput.addEventListener('input', function() {
            design.sliders[index].max = parseFloat(this.value) || 100;
            updateSliderValue(index);
        });

        logCheck.addEventListener('change', function() {
            design.sliders[index].logScale = this.checked;
            updateSliderValue(index);
        });

        rangeInput.addEventListener('input', function() {
            updateSliderValue(index);
        });

        removeBtn.addEventListener('click', function() {
            design.sliders.splice(index, 1);
            rebuildSliders();
            debounceUpdate();
        });
    }, 0);

    return div;
}

function updateSliderValue(index) {
    let slider = design.sliders[index];
    let rangeInput = document.getElementById('range-' + index);
    let valueSpan = document.getElementById('value-' + index);

    if (!rangeInput || !valueSpan) return;

    let pos = parseInt(rangeInput.value);
    let value = sliderPosToValue(pos, slider.min, slider.max, slider.logScale);

    slider.currentValue = value;
    valueSpan.textContent = formatValue(value);

    // Update immediately for real-time feedback
    updateAll();
}

function updateCodeFromSliders() {
    // Update parameter values in code based on slider values
    let lines = design.code.split('\n');
    let newLines = lines.map(line => {
        let trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed === '') return line;

        // Check if this line defines a slider parameter
        for (let slider of design.sliders) {
            if (!slider.name) continue;
            let regex = new RegExp(`^(\\s*${slider.name}\\s*=\\s*)([\\d.eE+-]+)(\\s*(?:#.*)?)$`);
            let match = line.match(regex);
            if (match && slider.currentValue !== undefined) {
                return match[1] + formatValue(slider.currentValue) + (match[3] || '');
            }
        }
        return line;
    });

    design.code = newLines.join('\n');
    document.getElementById('field-code').value = design.code;
}

function sliderPosToValue(pos, min, max, logScale) {
    let ratio = pos / 1000;
    if (logScale) {
        let logMin = Math.log10(Math.max(min, 1e-10));
        let logMax = Math.log10(Math.max(max, 1e-10));
        return Math.pow(10, logMin + ratio * (logMax - logMin));
    } else {
        return min + ratio * (max - min);
    }
}

function valueToSliderPos(value, min, max, logScale) {
    if (logScale) {
        let logMin = Math.log10(Math.max(min, 1e-10));
        let logMax = Math.log10(Math.max(max, 1e-10));
        let logValue = Math.log10(Math.max(value, 1e-10));
        return Math.round(((logValue - logMin) / (logMax - logMin)) * 1000);
    } else {
        return Math.round(((value - min) / (max - min)) * 1000);
    }
}

function formatValue(value) {
    if (Math.abs(value) >= 1000 || (Math.abs(value) < 0.01 && value !== 0)) {
        return value.toExponential(3);
    }
    return parseFloat(value.toPrecision(4)).toString();
}

function addSlider() {
    design.sliders.push({
        name: '',
        min: 0.1,
        max: 100,
        logScale: true,
        currentValue: 1
    });
    rebuildSliders();
}

function updateAll() {
    // Check if code has changed (need to recalculate symbolic expressions)
    let codeChanged = (cachedSymbolic.codeHash !== design.code);
    let parseErrors = [];  // Track errors

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
            let symbolicVars = { s: math.parse('s') };
            design.sliders.forEach(slider => {
                if (slider.name) {
                    symbolicVars[slider.name] = math.parse(slider.name);
                }
            });

            let lines = design.code.split('\n');
            lines.forEach((line, lineNum) => {
                line = line.trim();
                if (line === '' || line.startsWith('#')) return;

                try {
                    let eqIndex = line.indexOf('=');
                    if (eqIndex > 0) {
                        let varName = line.substring(0, eqIndex).trim();
                        let exprStr = line.substring(eqIndex + 1).trim();

                        let commentIndex = exprStr.indexOf('#');
                        if (commentIndex >= 0) {
                            exprStr = exprStr.substring(0, commentIndex).trim();
                        }

                        if (varName && exprStr) {
                            let expr = math.parse(exprStr);
                            let symSubstituted = substituteVars(expr, symbolicVars);
                            symbolicVars[varName] = symSubstituted;
                        }
                    }
                } catch (e) {
                    parseErrors.push({ line: lineNum + 1, message: e.message });
                }
            });

            // Cache symbolic expressions
            cachedSymbolic.codeHash = design.code;
            cachedSymbolic.Lsym = symbolicVars.L || null;

            // Pre-calculate rationalized symbolic expressions for display
            if (cachedSymbolic.Lsym && cachedSymbolic.Lsym.isNode) {
                try {
                    cachedSymbolic.LsymRat = util_rationalize(cachedSymbolic.Lsym);
                    let Tnum = cachedSymbolic.LsymRat.numerator;
                    let Tden = new math.OperatorNode('+', 'add', [
                        cachedSymbolic.LsymRat.numerator.clone(),
                        cachedSymbolic.LsymRat.denominator.clone()
                    ]);
                    cachedSymbolic.TsymSimplified = new math.OperatorNode('/', 'divide', [Tnum, Tden]);
                } catch (e) {
                    cachedSymbolic.LsymRat = null;
                    cachedSymbolic.TsymSimplified = null;
                }
            }
        }

        // Numerical calculation (always needed when sliders change)
        let lines = design.code.split('\n');
        lines.forEach((line, lineNum) => {
            line = line.trim();
            if (line === '' || line.startsWith('#')) return;

            try {
                let eqIndex = line.indexOf('=');
                if (eqIndex > 0) {
                    let varName = line.substring(0, eqIndex).trim();
                    let exprStr = line.substring(eqIndex + 1).trim();

                    let commentIndex = exprStr.indexOf('#');
                    if (commentIndex >= 0) {
                        exprStr = exprStr.substring(0, commentIndex).trim();
                    }

                    if (varName && exprStr) {
                        let expr = math.parse(exprStr);
                        let substituted = substituteVars(expr, currentVars);
                        currentVars[varName] = substituted;
                    }
                }
            } catch (e) {
                // Only add if not already recorded (codeChanged handles symbolic errors)
                if (!codeChanged) {
                    parseErrors.push({ line: lineNum + 1, message: e.message });
                }
            }
        });

        // Copy cached symbolic expressions to currentVars
        currentVars.Lsym = cachedSymbolic.Lsym;

        syncSlidersFromVars();

    } catch (e) {
        document.getElementById('field-code').classList.remove('is-valid');
        document.getElementById('field-code').classList.add('is-invalid');
        console.log('Parse error:', e);
        return;
    }

    // Check for undefined symbols in L
    let undefinedSymbols = [];
    if (currentVars.L && currentVars.L.isNode) {
        let definedVars = new Set(Object.keys(currentVars));
        definedVars.add('s');
        design.sliders.forEach(s => definedVars.add(s.name));

        currentVars.L.traverse(node => {
            if (node.isSymbolNode && !definedVars.has(node.name)) {
                if (!undefinedSymbols.includes(node.name)) {
                    undefinedSymbols.push(node.name);
                }
            }
        });
    }

    // Check if L is defined and valid
    let hasErrors = parseErrors.length > 0 || undefinedSymbols.length > 0;
    if (currentVars.L && !hasErrors) {
        document.getElementById('field-code').classList.remove('is-invalid');
        document.getElementById('field-code').classList.add('is-valid');
        calculateClosedLoopTF();
        displayTransferFunctions();
        updateClosedLoopPoles();  // Calculate closed-loop poles before frequency range
        autoAdjustFrequencyRange();
        updateBodePlot();
        updatePolePlot();
        updateMargins();
    } else if (hasErrors) {
        // Show error state
        document.getElementById('field-code').classList.remove('is-valid');
        document.getElementById('field-code').classList.add('is-invalid');

        let errorMsg = '';
        if (parseErrors.length > 0) {
            errorMsg = 'Parse error at line ' + parseErrors[0].line + ': ' + parseErrors[0].message;
        } else if (undefinedSymbols.length > 0) {
            errorMsg = 'Undefined variable(s): ' + undefinedSymbols.join(', ');
        }
        document.getElementById('eq-L-display').innerHTML =
            '<span class="text-danger">' + errorMsg + '</span>';
        document.getElementById('eq-T-display').innerHTML = '';
    } else {
        // L not defined, but no errors
        document.getElementById('field-code').classList.remove('is-valid');
        document.getElementById('field-code').classList.remove('is-invalid');
        document.getElementById('eq-L-display').innerHTML =
            '<span class="text-warning">Define L = ... to see the Bode plot</span>';
        document.getElementById('eq-T-display').innerHTML = '';
    }

    // Auto-save to URL (debounced)
    debouncedSaveToUrl();
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

function syncSlidersFromVars() {
    design.sliders.forEach((slider, index) => {
        if (!slider.name) return;
        let val = currentVars[slider.name];
        if (typeof val === 'number') {
            slider.currentValue = val;
            let rangeInput = document.getElementById('range-' + index);
            let valueSpan = document.getElementById('value-' + index);
            if (rangeInput && valueSpan) {
                let pos = valueToSliderPos(val, slider.min, slider.max, slider.logScale);
                rangeInput.value = pos;
                valueSpan.textContent = formatValue(val);
            }
        }
    });
}

function calculateClosedLoopTF() {
    // Numerical T calculation (for Bode plot and closed-loop poles)
    try {
        let L = currentVars.L;
        if (L && L.isNode) {
            // Rationalize L first: L = num/den
            let Lrat = util_rationalize(L);

            // T = L/(1+L) = num / (den + num)
            let charPoly = new math.OperatorNode('+', 'add', [Lrat.denominator.clone(), Lrat.numerator.clone()]);
            let T = new math.OperatorNode('/', 'divide', [Lrat.numerator.clone(), charPoly]);
            currentVars.T = T;
            currentVars.Lrat = Lrat;  // Store for closed-loop poles calculation
        }
    } catch (e) {
        console.log('Error calculating numerical T:', e);
    }
    // Note: Symbolic T calculation is now cached in updateAll() for efficiency
}

function displayTransferFunctions() {
    let displayL = document.getElementById('eq-L-display');
    let displayT = document.getElementById('eq-T-display');

    try {
        // Display cached symbolic L
        let Lsym = cachedSymbolic.Lsym;
        if (Lsym && Lsym.isNode) {
            let texString = Lsym.toTex({ parenthesis: 'auto', implicit: 'hide' });
            katex.render('L(s) = ' + texString, displayL, { displayMode: false, throwOnError: false });
        } else {
            displayL.innerHTML = '<span class="text-muted">--</span>';
        }
    } catch (e) {
        displayL.innerHTML = '<span class="text-danger">Error displaying L(s)</span>';
        console.log('L display error:', e);
    }

    try {
        // Display cached simplified symbolic T
        let TsymSimplified = cachedSymbolic.TsymSimplified;
        if (TsymSimplified && TsymSimplified.isNode) {
            let texString = TsymSimplified.toTex({ parenthesis: 'auto', implicit: 'hide' });
            katex.render('T(s) = \\frac{L(s)}{1+L(s)} = ' + texString, displayT, { displayMode: false, throwOnError: false });
        } else {
            displayT.innerHTML = '<span class="text-muted">--</span>';
        }
    } catch (e) {
        displayT.innerHTML = '<span class="text-danger">Error displaying T(s)</span>';
        console.log('T display error:', e);
    }
}

function updateBodePlot() {
    try {
        let L = currentVars.L;
        let T = currentVars.T;
        if (!L || !L.isNode) return;

        // Generate frequency array
        let w = logspace(design.freqMin, design.freqMax, design.freqPoints);

        // Prepare transfer functions for plotting
        let transferFunctions = [
            {
                compiled: L.compile(),
                gainColor: '#0088aa',
                phaseColor: '#0088aa',
                visible: showL
            }
        ];

        if (T && T.isNode) {
            transferFunctions.push({
                compiled: T.compile(),
                gainColor: '#22aa22',
                phaseColor: '#22aa22',
                visible: showT
            });
        }

        // Draw Bode plot with multiple transfer functions
        let margins = drawBodeMulti(transferFunctions, w, 'bode-wrapper', 'bode-canvas');
        window.lastMargins = margins;

    } catch (e) {
        console.log('Bode plot error:', e);
    }
}

function updateClosedLoopPoles() {
    try {
        let Lrat = currentVars.Lrat;
        if (!Lrat) {
            document.getElementById('clp-display').textContent = '--';
            document.getElementById('stability-indicator').textContent = '--';
            document.getElementById('stability-indicator').className = 'badge bg-secondary';
            window.lastZeros = [];
            return;
        }

        // Get characteristic polynomial: 1 + L = 0
        // L = num/den, so 1 + num/den = 0 => den + num = 0
        // Characteristic polynomial: den + num
        let charPolyNode = new math.OperatorNode('+', 'add', [Lrat.denominator.clone(), Lrat.numerator.clone()]);

        // Convert to string and rationalize to get coefficients
        let charPolyStr = charPolyNode.toString();
        let charPoly = math.rationalize(charPolyStr, true);

        let coeffs = charPoly.coefficients;
        if (coeffs && coeffs.length > 0) {
            let roots = findRoots(coeffs);
            displayClosedLoopPoles(roots);
        } else {
            document.getElementById('clp-display').textContent = 'No poles';
        }

        // Calculate zeros from L's numerator
        try {
            let numStr = Lrat.numerator.toString();
            let numPoly = math.rationalize(numStr, true);
            if (numPoly.coefficients && numPoly.coefficients.length > 1) {
                let numRoots = findRoots(numPoly.coefficients);
                window.lastZeros = root2math(numRoots);
            } else {
                window.lastZeros = [];
            }
        } catch (e) {
            window.lastZeros = [];
        }

    } catch (e) {
        console.log('CLP error:', e);
        let clpEl = document.getElementById('clp-display');
        clpEl.textContent = 'Error: ' + e.message;
        clpEl.classList.add('text-danger');
        clpEl.classList.remove('text-muted');
        window.lastZeros = [];
    }
}

function displayClosedLoopPoles(roots) {
    let clpEl = document.getElementById('clp-display');
    if (!roots || roots[0].length === 0) {
        clpEl.textContent = 'No poles';
        clpEl.classList.add('text-muted');
        clpEl.classList.remove('text-danger');
        return;
    }

    let poles = root2math(roots);
    let poleStrings = [];
    let isStable = true;

    for (let i = 0; i < poles.length; i++) {
        let p = poles[i];
        let poleStr = '';
        let isUnstable = p.re > 1e-10;

        if (isUnstable) {
            isStable = false;
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

        if (isUnstable) {
            poleStr += '}';
        }

        poleStrings.push(poleStr);
    }

    let latex = poleStrings.join(',\\; ');
    clpEl.classList.remove('text-danger', 'text-muted');
    katex.render(latex, clpEl, {
        displayMode: false,
        throwOnError: false
    });

    let indicator = document.getElementById('stability-indicator');
    if (isStable) {
        indicator.textContent = 'Stable';
        indicator.className = 'badge bg-success';
    } else {
        indicator.textContent = 'Unstable';
        indicator.className = 'badge bg-danger';
    }

    window.lastPoles = poles;
}

function updatePolePlot() {
    let canvas = document.getElementById('pole-canvas');
    let wrapper = document.getElementById('pole-wrapper');
    let ctx = canvas.getContext('2d');

    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;

    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    ctx.scale(devicePixelRatio, devicePixelRatio);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    let poles = window.lastPoles || [];
    let zeros = window.lastZeros || [];
    if (poles.length === 0 && zeros.length === 0) return;

    // Calculate scale based on both poles and zeros
    let maxRe = 0, maxIm = 0;
    poles.forEach(p => {
        maxRe = Math.max(maxRe, Math.abs(p.re));
        maxIm = Math.max(maxIm, Math.abs(p.im));
    });
    zeros.forEach(z => {
        maxRe = Math.max(maxRe, Math.abs(z.re));
        maxIm = Math.max(maxIm, Math.abs(z.im));
    });
    maxRe = Math.max(maxRe, 1) * 1.5;
    maxIm = Math.max(maxIm, 1) * 1.5;
    let maxScale = Math.max(maxRe, maxIm);

    const margin = 40;
    const plotWidth = width - 2 * margin;
    const plotHeight = height - 2 * margin;
    const scale = Math.min(plotWidth, plotHeight) / (2 * maxScale);

    let centerX = width / 2;
    let centerY = height / 2;

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;

    for (let x = -Math.ceil(maxScale); x <= Math.ceil(maxScale); x++) {
        let px = centerX + x * scale;
        ctx.beginPath();
        ctx.moveTo(px, margin);
        ctx.lineTo(px, height - margin);
        ctx.stroke();
    }

    for (let y = -Math.ceil(maxScale); y <= Math.ceil(maxScale); y++) {
        let py = centerY - y * scale;
        ctx.beginPath();
        ctx.moveTo(margin, py);
        ctx.lineTo(width - margin, py);
        ctx.stroke();
    }

    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, centerY);
    ctx.lineTo(width - margin, centerY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, margin);
    ctx.lineTo(centerX, height - margin);
    ctx.stroke();

    ctx.strokeStyle = '#cc0000';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(centerX, margin);
    ctx.lineTo(centerX, height - margin);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#333333';
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Re', width - margin + 15, centerY + 4);
    ctx.fillText('Im', centerX, margin - 10);

    const poleZeroColor = '#22aa22';  // Green (same as T in Bode plot)

    // Draw zeros as circles (○)
    zeros.forEach(z => {
        let px = centerX + z.re * scale;
        let py = centerY - z.im * scale;

        ctx.strokeStyle = poleZeroColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, 2 * Math.PI);
        ctx.stroke();
    });

    // Draw poles as crosses (×)
    poles.forEach(p => {
        let px = centerX + p.re * scale;
        let py = centerY - p.im * scale;

        ctx.strokeStyle = poleZeroColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(px - 5, py - 5);
        ctx.lineTo(px + 5, py + 5);
        ctx.moveTo(px + 5, py - 5);
        ctx.lineTo(px - 5, py + 5);
        ctx.stroke();
    });
}

function updateMargins() {
    let margins = window.lastMargins;
    if (!margins) return;

    let gmDisplay = document.getElementById('gm-display');
    let pmDisplay = document.getElementById('pm-display');

    if (margins.gainMargins.length > 0) {
        let gm = margins.gainMargins[0];
        let gmStr = gm.margin.toFixed(2) + ' dB @ ' + gm.frequency.toFixed(3) + ' rad/s';
        gmDisplay.textContent = gmStr;
        gmDisplay.className = gm.margin > 0 ? 'text-success' : 'text-danger';
    } else {
        gmDisplay.textContent = '∞';
        gmDisplay.className = 'text-success';
    }

    if (margins.phaseMargins.length > 0) {
        let pm = margins.phaseMargins[0];
        let pmStr = pm.margin.toFixed(2) + ' deg @ ' + pm.frequency.toFixed(3) + ' rad/s';
        pmDisplay.textContent = pmStr;
        pmDisplay.className = pm.margin > 0 ? 'text-success' : 'text-danger';
    } else {
        pmDisplay.textContent = 'N/A';
        pmDisplay.className = 'text-muted';
    }
}

function autoAdjustFrequencyRange() {
    if (!autoFreq) return;

    try {
        let L = currentVars.L;
        if (!L || !L.isNode) {
            console.log('autoAdjustFrequencyRange: L is not defined or not a node');
            return;
        }

        // Rationalize L to get numerator and denominator
        let Lrat = util_rationalize(L);
        if (!Lrat) {
            console.log('autoAdjustFrequencyRange: Failed to rationalize L');
            return;
        }

        console.log('autoAdjustFrequencyRange: Lrat =', Lrat);
        console.log('  numerator:', Lrat.numerator.toString());
        console.log('  denominator:', Lrat.denominator.toString());

        // Get poles from denominator and zeros from numerator
        let poles = [];
        let zeros = [];

        // Get denominator coefficients for poles
        try {
            let denStr = Lrat.denominator.toString();
            let denPoly = math.rationalize(denStr, true);
            console.log('  denPoly coefficients:', denPoly.coefficients);
            if (denPoly.coefficients && denPoly.coefficients.length > 1) {
                let denRoots = findRoots(denPoly.coefficients);
                poles = root2math(denRoots);
                console.log('  poles:', poles);
            }
        } catch (e) {
            console.log('  Error getting poles:', e);
        }

        // Get numerator coefficients for zeros
        try {
            let numStr = Lrat.numerator.toString();
            let numPoly = math.rationalize(numStr, true);
            console.log('  numPoly coefficients:', numPoly.coefficients);
            if (numPoly.coefficients && numPoly.coefficients.length > 1) {
                let numRoots = findRoots(numPoly.coefficients);
                zeros = root2math(numRoots);
                console.log('  zeros:', zeros);
            }
        } catch (e) {
            console.log('  Error getting zeros:', e);
        }

        // Also get closed-loop poles (roots of 1+L)
        let closedLoopPoles = [];
        try {
            let clPoles = window.lastPoles || [];
            closedLoopPoles = clPoles.map(p => ({ re: p.re, im: p.im }));
            console.log('  closed-loop poles:', closedLoopPoles);
        } catch (e) {
            console.log('  Error getting closed-loop poles:', e);
        }

        // Combine open-loop poles, zeros, and closed-loop poles
        let allRoots = [...poles, ...zeros, ...closedLoopPoles];
        let frequencies = allRoots
            .map(p => Math.sqrt(p.re * p.re + p.im * p.im))  // absolute value
            .filter(f => f > 1e-6);  // exclude near-zero

        console.log('  frequencies (including closed-loop):', frequencies);

        if (frequencies.length === 0) {
            // Default range if no poles/zeros found
            console.log('  No frequencies found, using default range');
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

            console.log('  Calculated range:', design.freqMin, 'to', design.freqMax);
        }

        // Update UI
        document.getElementById('field-freq-min').value = design.freqMin;
        document.getElementById('field-freq-max').value = design.freqMax;

    } catch (e) {
        console.log('Auto frequency range error:', e);
    }
}

function saveToUrl() {
    saveDesign();

    // Create a copy of design without layout (leftPanelWidth, bodeHeight)
    let saveData = { ...design };
    delete saveData.layout;

    // Don't save freqMin/freqMax if autoFreq is enabled
    if (saveData.autoFreq) {
        delete saveData.freqMin;
        delete saveData.freqMax;
    }

    let json = JSON.stringify(saveData);
    // Use pako (zlib) compression for shorter URLs
    let compressed = pako.deflate(json);
    // Convert to base64url encoding
    let base64 = btoa(String.fromCharCode.apply(null, compressed));
    let urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    let url = location.pathname + '#' + urlSafe;
    history.replaceState(null, '', url);
}

// Debounced URL update - saves 1 second after last change
function debouncedSaveToUrl() {
    if (urlUpdateTimeout) {
        clearTimeout(urlUpdateTimeout);
    }
    urlUpdateTimeout = setTimeout(() => {
        urlUpdateTimeout = null;
        saveToUrl();
    }, 1000);
}

function loadFromUrl() {
    if (location.hash.length > 1) {
        try {
            let encoded = location.hash.substring(1);
            let json = null;

            // Try pako (zlib) decompression first (new format)
            try {
                // Convert from base64url to base64
                let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
                // Add padding if needed
                while (base64.length % 4) base64 += '=';
                let binary = atob(base64);
                let bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                json = pako.inflate(bytes, { to: 'string' });
            } catch (e) {
                // Not pako format
            }

            // Fallback to old base64 format for backward compatibility
            if (!json || json.charAt(0) !== '{') {
                try {
                    json = decodeURIComponent(escape(atob(encoded)));
                } catch (e) {
                    // Not old format either
                }
            }

            if (json && json.charAt(0) === '{') {
                let loaded = JSON.parse(json);
                Object.assign(design, loaded);
                // Ensure layout defaults exist
                if (!design.layout) {
                    design.layout = { leftPanelWidth: 350 };
                }
                // Ensure collapsed defaults exist
                if (!design.collapsed) {
                    design.collapsed = {};
                }
            }
        } catch (e) {
            console.log('Failed to load from URL:', e);
        }
    }
}

window.addSlider = addSlider;
