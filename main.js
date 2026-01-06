// Main logic for loop shaping control design tool

// Default design
let design = {
    code: `K = Kp*(1 + Td*s)
P = 1/(s^2*(s + 1))
L = K * P`,
    sliders: [
        { name: 'Kp', min: 0.01, max: 10, logScale: true, currentValue: 1 },
        { name: 'Td', min: 0.1, max: 100, logScale: true, currentValue: 10 }
    ],
    freqMin: -2,
    freqMax: 3,
    freqPoints: 300,
    showL: true,
    showT: true,
    autoFreq: true,
    showLpz: true,  // Pole-Zero Map: show L(s)
    showTpz: true,  // Pole-Zero Map: show T(s)
};

let currentVars = {};
let updateTimeout = null;
let urlUpdateTimeout = null;
let showL = true;
let showT = true;
let autoFreq = true;
let showLpz = true;  // Pole-Zero Map: show L(s)
let showTpz = true;  // Pole-Zero Map: show T(s)

// Dockview API reference
let dockviewApi = null;

// Panel definitions for the View menu
const PANEL_DEFINITIONS = [
    { id: 'system-definition', component: 'system-definition', title: 'System Definition' },
    { id: 'parameters', component: 'parameters', title: 'Parameters' },
    { id: 'bode', component: 'bode', title: 'Bode Plot' },
    { id: 'stability', component: 'stability', title: 'Stability' },
    { id: 'frequency', component: 'frequency', title: 'Frequency Range' },
    { id: 'pole-zero', component: 'pole-zero', title: 'Pole-Zero Map' },
    { id: 'nyquist', component: 'nyquist', title: 'Nyquist Plot' }
];

// Get dockview-core from global scope (UMD build uses window["dockview-core"])
const dockview = window["dockview-core"];

// Dockview theme selection
const DOCKVIEW_THEME_CLASS = 'dockview-theme-light';

let dockviewThemeObserver = null;
let resizeListenerAttached = false;
let isNarrowLayout = false;

function applyDockviewTheme(el, themeClass) {
    if (!el) return;
    // remove any other theme classes to avoid CSS variable overrides
    for (const c of Array.from(el.classList)) {
        if (c.startsWith('dockview-theme-') && c !== themeClass) {
            el.classList.remove(c);
        }
    }
    el.classList.add(themeClass);
}

function lockDockviewTheme(el, themeClass) {
    applyDockviewTheme(el, themeClass);
    const observer = new MutationObserver(() => applyDockviewTheme(el, themeClass));
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return observer;
}

// Cached symbolic expressions (only recalculated when code changes)
let cachedSymbolic = {
    Lsym: null,
    LsymRat: null,  // Rationalized Lsym for T display
    TsymSimplified: null,
    codeHash: null
};

// Panel Renderer class for Dockview
class PanelRenderer {
    constructor(templateId) {
        this._element = document.createElement('div');
        this._element.className = 'panel-container';
        this._templateId = templateId;
    }

    get element() {
        return this._element;
    }

    init(params) {
        const template = document.getElementById('template-' + this._templateId);
        if (template) {
            const content = template.content.cloneNode(true);
            this._element.appendChild(content);
        }
    }
}

// Initialize Dockview
function initializeDockview() {
    const container = document.getElementById('dockview-container');

    dockviewApi = dockview.createDockview(container, {
        className: DOCKVIEW_THEME_CLASS,
        createComponent: (options) => {
            return new PanelRenderer(options.name);
        }
    });

    // Fix: ensure only the requested theme class is present.
    // Dockview may leave an extra theme class (e.g. dockview-theme-abyss) which overrides variables.
    applyDockviewTheme(container, DOCKVIEW_THEME_CLASS);
    applyDockviewTheme(container?.firstElementChild, DOCKVIEW_THEME_CLASS);

    if (dockviewThemeObserver) {
        dockviewThemeObserver.disconnect();
        dockviewThemeObserver = null;
    }
    if (container?.firstElementChild) {
        dockviewThemeObserver = lockDockviewTheme(container.firstElementChild, DOCKVIEW_THEME_CLASS);
    }

    // Always use default layout (layout is not saved to URL)
    createDefaultLayout();

    // Listen for layout changes to save and redraw canvases
    dockviewApi.onDidLayoutChange(() => {
        // Stop Nyquist animation during layout changes
        stopNyquistAnimation();

        debouncedSaveToUrl();
        // Delay redraw to allow layout to settle
        setTimeout(() => {
            updateBodePlot();
            updatePolePlot();
            updateNyquistPlot();
        }, 50);
    });

    // Listen for panel activation to reinitialize UI elements
    dockviewApi.onDidActivePanelChange((event) => {
        // Stop Nyquist animation when switching away from it
        stopNyquistAnimation();

        setTimeout(() => {
            initializeUI();
            setupEventListeners();

            // Redraw Nyquist plot if it becomes active
            if (event && event.panel && event.panel.id === 'nyquist') {
                updateNyquistPlot();
            }
        }, 50);
    });
}

// Create default layout (matches original design) - only used for wide screens
function createDefaultLayout() {
    // Left column: System Definition (top) + Parameters (bottom)
    dockviewApi.addPanel({
        id: 'system-definition',
        component: 'system-definition',
        title: 'System Definition',
    });

    // Right column: Bode Plot (top, larger)
    dockviewApi.addPanel({
        id: 'bode',
        component: 'bode',
        title: 'Bode Plot',
        position: { referencePanel: 'system-definition', direction: 'right' }
    });

    // Add frequency first, then parameters on top (so parameters is the active tab)
    dockviewApi.addPanel({
        id: 'frequency',
        component: 'frequency',
        title: 'Frequency Range',
        position: { referencePanel: 'system-definition', direction: 'below' },
    });

    dockviewApi.addPanel({
        id: 'parameters',
        component: 'parameters',
        title: 'Parameters',
        position: { referencePanel: 'frequency', direction: 'within' },  // Tab with Frequency, Parameters becomes active
    });

    // Bottom right: Stability + Pole-Zero Map
    dockviewApi.addPanel({
        id: 'stability',
        component: 'stability',
        title: 'Stability',
        position: { referencePanel: 'frequency', direction: 'below' },
    });

    dockviewApi.addPanel({
        id: 'pole-zero',
        component: 'pole-zero',
        title: 'Pole-Zero Map',
        position: { referencePanel: 'stability', direction: 'right' }
    });

    // Add Nyquist plot as a tab with Pole-Zero Map
    dockviewApi.addPanel({
        id: 'nyquist',
        component: 'nyquist',
        title: 'Nyquist Plot',
        position: { referencePanel: 'pole-zero', direction: 'within' }
    });

    // Adjust panel proportions after layout is created
    setTimeout(() => {
        try {
            // Set System Definition to a smaller height
            const sysDefPanel = dockviewApi.getPanel('system-definition');
            const freqPanel = dockviewApi.getPanel('frequency');
            if (sysDefPanel && sysDefPanel.api) {
                sysDefPanel.api.setSize({ height: 280 });
            }
            if (freqPanel && freqPanel.api) {
                freqPanel.api.setSize({ height: 220 });
            }
        } catch (e) {
            // Panel size adjustment may fail during layout changes
        }
    }, 100);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadFromUrl();

    isNarrowLayout = window.innerWidth < 768;

    if (isNarrowLayout) {
        // Narrow layout: use static HTML layout (no Dockview)
        initializeNarrowLayout();
    } else {
        // Wide layout: use Dockview
        initializeDockview();
        initializeViewMenu();
    }

    // Wait for panels to be rendered, then initialize UI
    setTimeout(() => {
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
    }, 100);
});

// Initialize narrow layout (static HTML, no Dockview)
function initializeNarrowLayout() {
    // Set up tab switching
    const tabBtns = document.querySelectorAll('.narrow-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabName = this.dataset.tab;

            // Update active button
            tabBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // Show/hide tab content
            document.getElementById('narrow-tab-bode').style.display = tabName === 'bode' ? 'flex' : 'none';
            document.getElementById('narrow-tab-pole-zero').style.display = tabName === 'pole-zero' ? 'flex' : 'none';
            document.getElementById('narrow-tab-nyquist').style.display = tabName === 'nyquist' ? 'flex' : 'none';

            // Redraw the visible plot
            if (tabName === 'bode') {
                updateBodePlot();
            } else if (tabName === 'pole-zero') {
                updateNarrowPolePlot();
            } else if (tabName === 'nyquist') {
                updateNarrowNyquistPlot();
            }
        });
    });

    // Set up Pole-Zero visibility checkboxes for narrow layout (Shoelace sl-checkbox uses 'sl-change' event)
    const chkLpz = document.getElementById('narrow-chk-show-L-pz');
    const chkTpz = document.getElementById('narrow-chk-show-T-pz');
    if (chkLpz) {
        chkLpz.addEventListener('sl-change', function() {
            updateNarrowPolePlot();
        });
    }
    if (chkTpz) {
        chkTpz.addEventListener('sl-change', function() {
            updateNarrowPolePlot();
        });
    }

    // Set up resize listener
    if (!resizeListenerAttached) {
        window.addEventListener('resize', function() {
            updateBodePlot();
            if (document.getElementById('narrow-tab-pole-zero').style.display !== 'none') {
                updateNarrowPolePlot();
            }
            if (document.getElementById('narrow-tab-nyquist').style.display !== 'none') {
                updateNarrowNyquistPlot();
            }
        });
        resizeListenerAttached = true;
    }
}

function initializeUI() {
    // Get element IDs based on layout mode
    const prefix = isNarrowLayout ? 'narrow-' : '';

    const codeField = document.getElementById(prefix + 'field-code');
    if (codeField) {
        // Shoelace sl-textarea uses 'value' property
        codeField.value = design.code;
    }

    // Frequency fields only exist in wide layout
    if (!isNarrowLayout) {
        const freqMinField = document.getElementById('field-freq-min');
        const freqMaxField = document.getElementById('field-freq-max');
        if (freqMinField) freqMinField.value = design.freqMin;
        if (freqMaxField) freqMaxField.value = design.freqMax;

        // Apply auto frequency range setting
        autoFreq = design.autoFreq !== undefined ? design.autoFreq : true;
        const chkAuto = document.getElementById('chk-freq-auto');
        if (chkAuto) chkAuto.checked = autoFreq;
        if (freqMinField) freqMinField.disabled = autoFreq;
        if (freqMaxField) freqMaxField.disabled = autoFreq;

        // Apply Pole-Zero Map visibility settings
        showLpz = design.showLpz !== undefined ? design.showLpz : true;
        showTpz = design.showTpz !== undefined ? design.showTpz : true;
        const chkLpz = document.getElementById('chk-show-L-pz');
        const chkTpz = document.getElementById('chk-show-T-pz');
        if (chkLpz) chkLpz.checked = showLpz;
        if (chkTpz) chkTpz.checked = showTpz;
    }

    rebuildSliders();

    // Apply Bode plot visibility settings
    showL = design.showL !== undefined ? design.showL : true;
    showT = design.showT !== undefined ? design.showT : true;
    const chkL = document.getElementById(prefix + 'chk-show-L');
    const chkT = document.getElementById(prefix + 'chk-show-T');
    // Shoelace sl-checkbox uses 'checked' property
    if (chkL) chkL.checked = showL;
    if (chkT) chkT.checked = showT;
}

function setupEventListeners() {
    const prefix = isNarrowLayout ? 'narrow-' : '';

    const codeField = document.getElementById(prefix + 'field-code');
    const addSliderBtn = document.getElementById(prefix + 'btn-add-slider');

    // Use data attribute to prevent duplicate event listeners
    if (codeField && !codeField.dataset.listenerAttached) {
        // Shoelace sl-textarea uses 'sl-input' event
        codeField.addEventListener('sl-input', debounceUpdate);
        codeField.dataset.listenerAttached = 'true';
    }
    if (addSliderBtn && !addSliderBtn.dataset.listenerAttached) {
        addSliderBtn.addEventListener('click', addSlider);
        addSliderBtn.dataset.listenerAttached = 'true';
    }

    // Bode plot visibility checkboxes (Shoelace sl-checkbox uses 'sl-change' event)
    const chkL = document.getElementById(prefix + 'chk-show-L');
    const chkT = document.getElementById(prefix + 'chk-show-T');
    if (chkL && !chkL.dataset.listenerAttached) {
        chkL.addEventListener('sl-change', function() {
            showL = this.checked;
            design.showL = showL;
            updateBodePlot();
            debouncedSaveToUrl();
        });
        chkL.dataset.listenerAttached = 'true';
    }
    if (chkT && !chkT.dataset.listenerAttached) {
        chkT.addEventListener('sl-change', function() {
            showT = this.checked;
            design.showT = showT;
            updateBodePlot();
            debouncedSaveToUrl();
        });
        chkT.dataset.listenerAttached = 'true';
    }

    // Wide layout only elements
    if (!isNarrowLayout) {
        const freqMinField = document.getElementById('field-freq-min');
        const freqMaxField = document.getElementById('field-freq-max');

        // Shoelace sl-input uses 'sl-input' event
        if (freqMinField && !freqMinField.dataset.listenerAttached) {
            freqMinField.addEventListener('sl-input', debounceUpdate);
            freqMinField.dataset.listenerAttached = 'true';
        }
        if (freqMaxField && !freqMaxField.dataset.listenerAttached) {
            freqMaxField.addEventListener('sl-input', debounceUpdate);
            freqMaxField.dataset.listenerAttached = 'true';
        }

        // Auto frequency range checkbox (Shoelace sl-checkbox uses 'sl-change' event)
        const chkAuto = document.getElementById('chk-freq-auto');
        if (chkAuto && !chkAuto.dataset.listenerAttached) {
            chkAuto.addEventListener('sl-change', function() {
                autoFreq = this.checked;
                design.autoFreq = autoFreq;
                const freqMinEl = document.getElementById('field-freq-min');
                const freqMaxEl = document.getElementById('field-freq-max');
                if (freqMinEl) freqMinEl.disabled = autoFreq;
                if (freqMaxEl) freqMaxEl.disabled = autoFreq;
                if (autoFreq) {
                    autoAdjustFrequencyRange();
                }
                updateAll();
            });
            chkAuto.dataset.listenerAttached = 'true';
        }

        // Pole-Zero Map visibility checkboxes (Shoelace sl-checkbox uses 'sl-change' event)
        const chkLpz = document.getElementById('chk-show-L-pz');
        const chkTpz = document.getElementById('chk-show-T-pz');
        if (chkLpz && !chkLpz.dataset.listenerAttached) {
            chkLpz.addEventListener('sl-change', function() {
                showLpz = this.checked;
                design.showLpz = showLpz;
                updatePolePlot();
                debouncedSaveToUrl();
            });
            chkLpz.dataset.listenerAttached = 'true';
        }
        if (chkTpz && !chkTpz.dataset.listenerAttached) {
            chkTpz.addEventListener('sl-change', function() {
                showTpz = this.checked;
                design.showTpz = showTpz;
                updatePolePlot();
                debouncedSaveToUrl();
            });
            chkTpz.dataset.listenerAttached = 'true';
        }

        // Nyquist plot mouse wheel for compression radius
        const nyquistWrapper = document.getElementById('nyquist-wrapper');
        if (nyquistWrapper && !nyquistWrapper.dataset.wheelListenerAttached) {
            nyquistWrapper.addEventListener('wheel', function(e) {
                e.preventDefault();
                // Adjust compression radius with mouse wheel
                const delta = e.deltaY > 0 ? -0.5 : 0.5;
                nyquistCompressionRadius = Math.max(0.5, Math.min(100, nyquistCompressionRadius + delta));
                updateNyquistPlot();
            }, { passive: false });
            nyquistWrapper.dataset.wheelListenerAttached = 'true';
        }
    }

    // Window resize listener (only attach once)
    if (!resizeListenerAttached) {
        window.addEventListener('resize', function() {
            updateBodePlot();
            if (!isNarrowLayout) {
                updatePolePlot();
                updateNyquistPlot();
            }
        });
        resizeListenerAttached = true;
    }
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
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const codeField = document.getElementById(prefix + 'field-code');

    if (codeField) design.code = codeField.value;

    // Frequency fields only exist in wide layout
    if (!isNarrowLayout) {
        const freqMinField = document.getElementById('field-freq-min');
        const freqMaxField = document.getElementById('field-freq-max');
        if (freqMinField) design.freqMin = parseFloat(freqMinField.value) || -2;
        if (freqMaxField) design.freqMax = parseFloat(freqMaxField.value) || 3;
    }
}

function rebuildSliders() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let container = document.getElementById(prefix + 'sliders-container');
    if (!container) return;

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
            <sl-input type="text" class="slider-name" placeholder="Name" value="${slider.name || ''}" data-index="${index}" size="small"></sl-input>
            <sl-input type="number" class="slider-min" placeholder="Min" value="${slider.min || 0.1}" step="any" data-index="${index}" size="small"></sl-input>
            <sl-input type="number" class="slider-max" placeholder="Max" value="${slider.max || 100}" step="any" data-index="${index}" size="small"></sl-input>
            <sl-checkbox class="slider-log" id="log-${index}" ${slider.logScale ? 'checked' : ''} data-index="${index}" size="medium"></sl-checkbox>
            <sl-icon-button class="remove-slider" name="x-lg" data-index="${index}" label="Remove"></sl-icon-button>
        </div>
        <div class="slider-control">
            <sl-range class="slider-range" id="range-${index}" min="0" max="1000" value="${initialPos}" data-index="${index}"></sl-range>
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

        // Set tooltip formatter to show actual parameter value
        rangeInput.tooltipFormatter = (pos) => {
            const s = design.sliders[index];
            if (!s) return pos;
            const value = sliderPosToValue(pos, s.min, s.max, s.logScale);
            return formatValue(value);
        };

        // Shoelace sl-input uses 'sl-input' event
        nameInput.addEventListener('sl-input', function() {
            design.sliders[index].name = this.value;
            updateCodeFromSliders();
            debounceUpdate();
        });

        minInput.addEventListener('sl-input', function() {
            design.sliders[index].min = parseFloat(this.value) || 0.1;
            updateSliderValue(index);
        });

        maxInput.addEventListener('sl-input', function() {
            design.sliders[index].max = parseFloat(this.value) || 100;
            updateSliderValue(index);
        });

        // Shoelace sl-checkbox uses 'sl-change' event
        logCheck.addEventListener('sl-change', function() {
            design.sliders[index].logScale = this.checked;
            updateSliderValue(index);
        });

        // Shoelace sl-range uses 'sl-input' event
        rangeInput.addEventListener('sl-input', function() {
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
    const codeField = document.getElementById('field-code');
    if (codeField) codeField.value = design.code;
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
                    // Simplify numerator and denominator separately
                    let Tnum = math.simplify(cachedSymbolic.LsymRat.numerator);
                    let Tden = math.simplify(
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
        calculateClosedLoopTF();
        displayTransferFunctions();
        updateClosedLoopPoles();  // Calculate closed-loop poles before frequency range
        autoAdjustFrequencyRange();
        updateBodePlot();
        if (!isNarrowLayout) {
            updatePolePlot();
            updateNyquistPlot();
        } else {
            // Update narrow plots if the tab is visible
            let narrowPoleTab = document.getElementById('narrow-tab-pole-zero');
            if (narrowPoleTab && narrowPoleTab.style.display !== 'none') {
                updateNarrowPolePlot();
            }
            let narrowNyquistTab = document.getElementById('narrow-tab-nyquist');
            if (narrowNyquistTab && narrowNyquistTab.style.display !== 'none') {
                updateNarrowNyquistPlot();
            }
        }
        updateMargins();
        updateNyquistInfo();
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
    // T calculation (for Bode plot and closed-loop poles)
    let L = currentVars.L;
    if (!L || !L.isNode) return;

    // Always create T = L / (1 + L) symbolically (works for any L including exp, sin, etc.)
    let one = new math.ConstantNode(1);
    let onePlusL = new math.OperatorNode('+', 'add', [one, L.clone()]);
    let T = new math.OperatorNode('/', 'divide', [L.clone(), onePlusL]);
    currentVars.T = T;

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
                gainColor: '#dd6600',
                phaseColor: '#dd6600',
                visible: showT
            });
        }

        // Draw Bode plot with multiple transfer functions
        const prefix = isNarrowLayout ? 'narrow-' : '';
        let margins = drawBodeMulti(transferFunctions, w, prefix + 'bode-wrapper', prefix + 'bode-canvas');
        window.lastMargins = margins;

    } catch (e) {
        console.log('Bode plot error:', e);
    }
}

function updateClosedLoopPoles() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let clpEl = document.getElementById(prefix + 'clp-display');
    let indicator = document.getElementById(prefix + 'stability-indicator');

    try {
        let L = currentVars.L;
        if (!L || !L.isNode) {
            if (clpEl) clpEl.textContent = '--';
            if (indicator) {
                indicator.textContent = '--';
                indicator.variant = 'neutral';
            }
            window.lastPoles = [];
            window.lastZeros = [];
            return;
        }

        // Analyze L structure to determine stability calculation method
        let structure = analyzeLstructure(L);

        if (structure.type === 'unknown') {
            // Cannot determine P, skip stability calculation
            if (clpEl) clpEl.textContent = '--';
            if (indicator) {
                indicator.textContent = '--';
                indicator.variant = 'neutral';
            }
            window.lastPoles = [];
            window.lastZeros = [];
            return;
        }

        // Calculate P (number of open-loop RHP poles)
        let P = countRHPpoles(structure.rationalPart);
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

        // Find poles on imaginary axis (need special handling in Nyquist)
        let imagAxisPoles = findImaginaryAxisPoles(structure.rationalPart);

        // Calculate N (winding number) using Nyquist criterion
        // Use a wide frequency range for accurate winding number calculation
        let wNyquist = logspace(-4, 6, 2000);
        let Lcompiled = L.compile();
        let N = calculateWindingNumber(Lcompiled, wNyquist, imagAxisPoles);

        // Nyquist criterion: Z = N + P
        // Z = number of closed-loop RHP poles
        // System is stable if Z = 0
        let Z = N + P;

        // Display closed-loop poles if L is rational (can calculate exactly)
        if (structure.type === 'rational') {
            let Lrat = currentVars.Lrat;
            if (Lrat) {
                // Get characteristic polynomial: 1 + L = 0
                let charPolyNode = new math.OperatorNode('+', 'add', [Lrat.denominator.clone(), Lrat.numerator.clone()]);
                let charPolyStr = charPolyNode.toString();
                let charPoly = math.rationalize(charPolyStr, true);

                let coeffs = charPoly.coefficients;
                if (coeffs && coeffs.length > 0) {
                    let roots = findRoots(coeffs);
                    displayClosedLoopPoles(roots, Z === 0);
                } else {
                    if (clpEl) clpEl.textContent = 'No poles';
                    updateStabilityIndicator(Z === 0);
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
            }
        } else {
            // For rational_delay, show Nyquist-based stability only
            if (clpEl) {
                clpEl.textContent = Z === 0 ? '(Nyquist stable)' : `(${Z} RHP poles)`;
                clpEl.classList.remove('text-danger', 'text-muted');
            }
            updateStabilityIndicator(Z === 0);
            window.lastPoles = [];
            window.lastZeros = [];
        }

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

function displayClosedLoopPoles(roots, isStableByNyquist) {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let clpEl = document.getElementById(prefix + 'clp-display');
    if (!clpEl) return;

    if (!roots || roots[0].length === 0) {
        clpEl.textContent = 'No poles';
        clpEl.classList.add('text-muted');
        clpEl.classList.remove('text-danger');
        updateStabilityIndicator(isStableByNyquist);
        return;
    }

    let poles = root2math(roots);
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

    let latex = poleStrings.join(',\\; ');
    clpEl.classList.remove('text-danger', 'text-muted');
    katex.render(latex, clpEl, {
        displayMode: false,
        throwOnError: false
    });

    // Use Nyquist-based stability determination
    updateStabilityIndicator(isStableByNyquist);

    window.lastPoles = poles;
}

function updatePolePlot() {
    let canvas = document.getElementById('pole-canvas');
    let wrapper = document.getElementById('pole-wrapper');

    if (!canvas || !wrapper) return;

    let ctx = canvas.getContext('2d');

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

    // T(s) closed-loop poles and zeros (from stability calculation)
    let Tpoles = window.lastPoles || [];
    let Tzeros = window.lastZeros || [];

    // L(s) open-loop poles and zeros (from Lrat)
    let Lpoles = [];
    let Lzeros = [];

    // Calculate L(s) poles and zeros from Lrat
    let Lrat = currentVars.Lrat;
    if (Lrat) {
        // Get poles from denominator
        try {
            let denStr = Lrat.denominator.toString();
            let denPoly = math.rationalize(denStr, true);
            if (denPoly.coefficients && denPoly.coefficients.length > 1) {
                let denRoots = findRoots(denPoly.coefficients);
                Lpoles = root2math(denRoots);
            }
        } catch (e) {
            // Ignore errors
        }

        // Get zeros from numerator
        try {
            let numStr = Lrat.numerator.toString();
            let numPoly = math.rationalize(numStr, true);
            if (numPoly.coefficients && numPoly.coefficients.length > 1) {
                let numRoots = findRoots(numPoly.coefficients);
                Lzeros = root2math(numRoots);
            }
        } catch (e) {
            // Ignore errors
        }
    }

    // Collect all points to display based on visibility settings
    let allPoints = [];
    if (showLpz) {
        Lpoles.forEach(p => allPoints.push(p));
        Lzeros.forEach(z => allPoints.push(z));
    }
    if (showTpz) {
        Tpoles.forEach(p => allPoints.push(p));
        Tzeros.forEach(z => allPoints.push(z));
    }

    if (allPoints.length === 0) return;

    // Calculate scale based on all visible poles and zeros
    let maxRe = 0, maxIm = 0;
    allPoints.forEach(p => {
        maxRe = Math.max(maxRe, Math.abs(p.re));
        maxIm = Math.max(maxIm, Math.abs(p.im));
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

    // Calculate nice circular grid radii
    let maxRadius = Math.sqrt(maxRe * maxRe + maxIm * maxIm) / 1.5;
    maxRadius = Math.max(maxRadius, 1);

    // Find a nice step size (1, 2, 5, 10, 20, 50, ...)
    let magnitude = Math.pow(10, Math.floor(Math.log10(maxRadius)));
    let normalized = maxRadius / magnitude;
    let niceStep;
    if (normalized <= 1) niceStep = magnitude * 0.5;
    else if (normalized <= 2) niceStep = magnitude;
    else if (normalized <= 5) niceStep = magnitude * 2;
    else niceStep = magnitude * 5;

    // Draw circular grid
    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 1;

    let maxCircleRadius = Math.ceil(maxScale / niceStep) * niceStep;
    for (let r = niceStep; r <= maxCircleRadius; r += niceStep) {
        let pixelRadius = r * scale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, pixelRadius, 0, 2 * Math.PI);
        ctx.stroke();
    }

    // Draw radial lines (every 45 degrees)
    for (let angle = 0; angle < Math.PI; angle += Math.PI / 4) {
        let dx = Math.cos(angle) * maxCircleRadius * scale;
        let dy = Math.sin(angle) * maxCircleRadius * scale;
        ctx.beginPath();
        ctx.moveTo(centerX - dx, centerY + dy);
        ctx.lineTo(centerX + dx, centerY - dy);
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

    ctx.strokeStyle = '#333333';
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

    // Draw tick labels on positive real axis (at circle intersections)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let r = niceStep; r <= maxCircleRadius; r += niceStep) {
        let px = centerX + r * scale;
        if (px < width - margin - 10) {
            let label = (r >= 1 || r === 0) ? r.toFixed(0) : r.toPrecision(1);
            ctx.fillText(label, px, centerY + 5);
        }
    }

    const colorL = '#0088aa';  // L(s) color (same as Bode plot)
    const colorT = '#dd6600';  // T(s) color (same as Bode plot)

    // Helper function to draw a zero (circle)
    function drawZero(z, color) {
        let px = centerX + z.re * scale;
        let py = centerY - z.im * scale;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, 2 * Math.PI);
        ctx.stroke();
    }

    // Helper function to draw a pole (cross)
    function drawPole(p, color) {
        let px = centerX + p.re * scale;
        let py = centerY - p.im * scale;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(px - 5, py - 5);
        ctx.lineTo(px + 5, py + 5);
        ctx.moveTo(px + 5, py - 5);
        ctx.lineTo(px - 5, py + 5);
        ctx.stroke();
    }

    // Draw L(s) poles and zeros (if visible)
    if (showLpz) {
        Lzeros.forEach(z => drawZero(z, colorL));
        Lpoles.forEach(p => drawPole(p, colorL));
    }

    // Draw T(s) poles and zeros (if visible)
    if (showTpz) {
        Tzeros.forEach(z => drawZero(z, colorT));
        Tpoles.forEach(p => drawPole(p, colorT));
    }
}

// Narrow layout pole-zero plot (separate function to handle narrow-specific element IDs)
function updateNarrowPolePlot() {
    let canvas = document.getElementById('narrow-pole-canvas');
    let wrapper = document.getElementById('narrow-pole-wrapper');

    if (!canvas || !wrapper) return;

    let ctx = canvas.getContext('2d');

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

    // T(s) closed-loop poles and zeros (from stability calculation)
    let Tpoles = window.lastPoles || [];
    let Tzeros = window.lastZeros || [];

    // L(s) open-loop poles and zeros (from Lrat)
    let Lpoles = [];
    let Lzeros = [];

    // Calculate L(s) poles and zeros from Lrat
    let Lrat = currentVars.Lrat;
    if (Lrat) {
        try {
            let denStr = Lrat.denominator.toString();
            let denPoly = math.rationalize(denStr, true);
            if (denPoly.coefficients && denPoly.coefficients.length > 1) {
                let denRoots = findRoots(denPoly.coefficients);
                Lpoles = root2math(denRoots);
            }
        } catch (e) {
            // Ignore errors
        }

        try {
            let numStr = Lrat.numerator.toString();
            let numPoly = math.rationalize(numStr, true);
            if (numPoly.coefficients && numPoly.coefficients.length > 1) {
                let numRoots = findRoots(numPoly.coefficients);
                Lzeros = root2math(numRoots);
            }
        } catch (e) {
            // Ignore errors
        }
    }

    // Get visibility settings from narrow layout checkboxes
    let narrowShowLpz = document.getElementById('narrow-chk-show-L-pz')?.checked ?? true;
    let narrowShowTpz = document.getElementById('narrow-chk-show-T-pz')?.checked ?? true;

    // Collect all points to display based on visibility settings
    let allPoints = [];
    if (narrowShowLpz) {
        Lpoles.forEach(p => allPoints.push(p));
        Lzeros.forEach(z => allPoints.push(z));
    }
    if (narrowShowTpz) {
        Tpoles.forEach(p => allPoints.push(p));
        Tzeros.forEach(z => allPoints.push(z));
    }

    if (allPoints.length === 0) return;

    // Calculate scale based on all visible poles and zeros
    let maxRe = 0, maxIm = 0;
    allPoints.forEach(p => {
        maxRe = Math.max(maxRe, Math.abs(p.re));
        maxIm = Math.max(maxIm, Math.abs(p.im));
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

    // Calculate nice circular grid radii
    let maxRadius = Math.sqrt(maxRe * maxRe + maxIm * maxIm) / 1.5;
    maxRadius = Math.max(maxRadius, 1);

    let magnitude = Math.pow(10, Math.floor(Math.log10(maxRadius)));
    let normalized = maxRadius / magnitude;
    let niceStep;
    if (normalized <= 1) niceStep = magnitude * 0.5;
    else if (normalized <= 2) niceStep = magnitude;
    else if (normalized <= 5) niceStep = magnitude * 2;
    else niceStep = magnitude * 5;

    // Draw circular grid
    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 1;

    let maxCircleRadius = Math.ceil(maxScale / niceStep) * niceStep;
    for (let r = niceStep; r <= maxCircleRadius; r += niceStep) {
        let pixelRadius = r * scale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, pixelRadius, 0, 2 * Math.PI);
        ctx.stroke();
    }

    // Draw radial lines (every 45 degrees)
    for (let angle = 0; angle < Math.PI; angle += Math.PI / 4) {
        let dx = Math.cos(angle) * maxCircleRadius * scale;
        let dy = Math.sin(angle) * maxCircleRadius * scale;
        ctx.beginPath();
        ctx.moveTo(centerX - dx, centerY + dy);
        ctx.lineTo(centerX + dx, centerY - dy);
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

    ctx.strokeStyle = '#333333';
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

    // Draw tick labels on positive real axis
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let r = niceStep; r <= maxCircleRadius; r += niceStep) {
        let px = centerX + r * scale;
        if (px < width - margin - 10) {
            let label = (r >= 1 || r === 0) ? r.toFixed(0) : r.toPrecision(1);
            ctx.fillText(label, px, centerY + 5);
        }
    }

    const colorL = '#0088aa';
    const colorT = '#dd6600';

    function drawZero(z, color) {
        let px = centerX + z.re * scale;
        let py = centerY - z.im * scale;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, 2 * Math.PI);
        ctx.stroke();
    }

    function drawPole(p, color) {
        let px = centerX + p.re * scale;
        let py = centerY - p.im * scale;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(px - 5, py - 5);
        ctx.lineTo(px + 5, py + 5);
        ctx.moveTo(px + 5, py - 5);
        ctx.lineTo(px - 5, py + 5);
        ctx.stroke();
    }

    if (narrowShowLpz) {
        Lzeros.forEach(z => drawZero(z, colorL));
        Lpoles.forEach(p => drawPole(p, colorL));
    }

    if (narrowShowTpz) {
        Tzeros.forEach(z => drawZero(z, colorT));
        Tpoles.forEach(p => drawPole(p, colorT));
    }
}

function updateNarrowNyquistPlot() {
    let wrapper = document.getElementById('narrow-nyquist-wrapper');
    let canvas = document.getElementById('narrow-nyquist-canvas');

    if (!wrapper || !canvas) return;

    // Update the mapping formula display with current R value
    updateNarrowNyquistMappingFormula();

    let L = currentVars.L;
    if (!L || !L.isNode) {
        // Clear canvas if L is not defined
        let ctx = canvas.getContext('2d');
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
        let Lcompiled = L.compile();

        // Analyze L structure to get imaginary axis poles
        let structure = analyzeLstructure(L);
        let imagAxisPoles = [];
        if (structure.type !== 'unknown' && structure.rationalPart) {
            imagAxisPoles = findImaginaryAxisPoles(structure.rationalPart);
        }

        drawNyquist(Lcompiled, imagAxisPoles, {
            wrapperId: 'narrow-nyquist-wrapper',
            canvasId: 'narrow-nyquist-canvas',
            animate: true
        });
    } catch (e) {
        console.log('Narrow Nyquist plot error:', e);
    }
}

function updateNarrowNyquistMappingFormula() {
    let formulaEl = document.getElementById('narrow-nyquist-mapping-formula');
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
        formulaEl.textContent = `z → z/(1+|z|/${RStr})`;
    }
}

function updateNyquistPlot() {
    let wrapper = document.getElementById('nyquist-wrapper');
    let canvas = document.getElementById('nyquist-canvas');

    if (!wrapper || !canvas) return;

    // Update the mapping formula display with current R value
    updateNyquistMappingFormula();

    let L = currentVars.L;
    if (!L || !L.isNode) {
        // Clear canvas if L is not defined
        let ctx = canvas.getContext('2d');
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
        let Lcompiled = L.compile();

        // Analyze L structure to get imaginary axis poles
        let structure = analyzeLstructure(L);
        let imagAxisPoles = [];
        if (structure.type !== 'unknown' && structure.rationalPart) {
            imagAxisPoles = findImaginaryAxisPoles(structure.rationalPart);
        }

        drawNyquist(Lcompiled, imagAxisPoles, {
            wrapperId: 'nyquist-wrapper',
            canvasId: 'nyquist-canvas',
            animate: true
        });
    } catch (e) {
        console.log('Nyquist plot error:', e);
    }
}

function updateNyquistMappingFormula() {
    let formulaEl = document.getElementById('nyquist-mapping-formula');
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
        formulaEl.textContent = `z → z/(1+|z|/${RStr})`;
    }
}

function updateMargins() {
    let margins = window.lastMargins;
    if (!margins) return;

    const prefix = isNarrowLayout ? 'narrow-' : '';
    let gmDisplay = document.getElementById(prefix + 'gm-display');
    let pmDisplay = document.getElementById(prefix + 'pm-display');

    if (!gmDisplay || !pmDisplay) return;

    if (margins.gainMargins.length > 0) {
        let gm = margins.gainMargins[0];
        let gmStr = gm.margin.toFixed(2) + ' dB @ ' + gm.frequency.toFixed(3) + ' rad/s';
        gmDisplay.textContent = gmStr;
        gmDisplay.className = gm.margin > 0 ? 'text-success' : 'text-danger';
    } else {
        gmDisplay.textContent = '\u221e';
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

function updateNyquistInfo() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let openLoopDisplay = document.getElementById(prefix + 'open-loop-unstable-display');
    let windingDisplay = document.getElementById(prefix + 'winding-number-display');

    // If elements not found, exit silently
    if (!openLoopDisplay || !windingDisplay) {
        return;
    }

    let L = currentVars.L;
    if (!L || !L.isNode) {
        openLoopDisplay.textContent = '--';
        openLoopDisplay.className = 'text-muted';
        windingDisplay.textContent = '--';
        windingDisplay.className = 'text-muted';
        return;
    }

    try {
        // Analyze L structure to get rational part and imaginary axis poles
        let structure = analyzeLstructure(L);
        if (structure.type === 'unknown' || !structure.rationalPart) {
            openLoopDisplay.textContent = '--';
            openLoopDisplay.className = 'text-muted';
            windingDisplay.textContent = '--';
            windingDisplay.className = 'text-muted';
            return;
        }

        // Get imaginary axis poles for proper Nyquist contour handling
        let imagAxisPoles = findImaginaryAxisPoles(structure.rationalPart);

        // Count unstable open-loop poles (Re > 0) using countRHPpoles
        let P = countRHPpoles(structure.rationalPart);
        if (P === null) {
            openLoopDisplay.textContent = '--';
            openLoopDisplay.className = 'text-muted';
            windingDisplay.textContent = '--';
            windingDisplay.className = 'text-muted';
            return;
        }

        // Calculate winding number
        let Lcompiled = L.compile();
        let wArray = logspace(-4, 6, 2000);
        let N = calculateWindingNumber(Lcompiled, wArray, imagAxisPoles);

        // Display P (number of unstable open-loop poles)
        openLoopDisplay.textContent = P.toString();
        openLoopDisplay.className = P === 0 ? 'text-success' : 'text-warning';

        // Display N (winding number)
        // For stability: N + P should equal 0 (Z = N + P = 0 closed-loop unstable poles)
        // Note: N is typically negative when encircling -1 CCW
        windingDisplay.textContent = N.toString();
        let Z = N + P;
        if (Z === 0) {
            windingDisplay.className = 'text-success';
        } else {
            windingDisplay.className = 'text-danger';
        }

    } catch (e) {
        console.log('Nyquist info error:', e);
        openLoopDisplay.textContent = '--';
        openLoopDisplay.className = 'text-muted';
        windingDisplay.textContent = '--';
        windingDisplay.className = 'text-muted';
    }
}

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
            // Ignore errors
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
            // Ignore errors
        }

        // Also get closed-loop poles (roots of 1+L)
        let closedLoopPoles = [];
        try {
            let clPoles = window.lastPoles || [];
            closedLoopPoles = clPoles.map(p => ({ re: p.re, im: p.im }));
        } catch (e) {
            // Ignore errors
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

        // Update UI
        const freqMinField = document.getElementById('field-freq-min');
        const freqMaxField = document.getElementById('field-freq-max');
        if (freqMinField) freqMinField.value = design.freqMin;
        if (freqMaxField) freqMaxField.value = design.freqMax;

    } catch (e) {
        console.log('Auto frequency range error:', e);
    }
}

function saveToUrl() {
    saveDesign();

    // Create a copy of design for saving (excluding layout info)
    let saveData = { ...design };

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
            }
        } catch (e) {
            console.log('Failed to load from URL:', e);
        }
    }
}

// Reset layout to default
function resetLayout() {
    if (dockviewApi) {
        dockviewApi.clear();
        createDefaultLayout();
    }
}

// View menu functions
function initializeViewMenu() {
    const viewDropdown = document.getElementById('view-dropdown');
    const viewMenu = document.getElementById('view-menu');

    if (!viewDropdown || !viewMenu) return;

    // Update menu items when dropdown opens
    viewDropdown.addEventListener('sl-show', function() {
        updateViewMenuItems();
    });

    // Handle menu item selection
    viewMenu.addEventListener('sl-select', function(e) {
        const item = e.detail.item;
        const panelId = item.dataset.panelId;
        const action = item.dataset.action;

        if (action === 'reset') {
            resetLayout();
            setTimeout(() => {
                initializeUI();
                setupEventListeners();
                updateAll();
            }, 100);
        } else if (panelId) {
            if (isPanelOpen(panelId)) {
                closePanel(panelId);
            } else {
                openPanel(panelId);
            }
        }
    });

    // Initial population
    updateViewMenuItems();
}

function updateViewMenuItems() {
    const viewMenu = document.getElementById('view-menu');
    if (!viewMenu) return;

    viewMenu.innerHTML = '';

    // Add panel items using Shoelace sl-menu-item
    PANEL_DEFINITIONS.forEach(panel => {
        const isOpen = isPanelOpen(panel.id);
        const item = document.createElement('sl-menu-item');
        item.dataset.panelId = panel.id;
        item.type = 'checkbox';
        item.checked = isOpen;
        item.textContent = panel.title;
        viewMenu.appendChild(item);
    });

    // Add separator using Shoelace sl-divider
    const separator = document.createElement('sl-divider');
    viewMenu.appendChild(separator);

    // Add reset layout option
    const resetItem = document.createElement('sl-menu-item');
    resetItem.dataset.action = 'reset';
    resetItem.textContent = 'Reset Layout';
    viewMenu.appendChild(resetItem);
}

function isPanelOpen(panelId) {
    if (!dockviewApi) return false;
    try {
        const panel = dockviewApi.getPanel(panelId);
        return panel !== undefined && panel !== null;
    } catch (e) {
        return false;
    }
}

function openPanel(panelId) {
    if (!dockviewApi || isPanelOpen(panelId)) return;

    const panelDef = PANEL_DEFINITIONS.find(p => p.id === panelId);
    if (!panelDef) return;

    const options = {
        id: panelDef.id,
        component: panelDef.component,
        title: panelDef.title
    };

    // Determine best position based on panel type
    if (panelId === 'bode' || panelId === 'pole-zero' || panelId === 'nyquist') {
        // Plot panels: prefer right side or below existing plots
        if (isPanelOpen('bode') && panelId === 'pole-zero') {
            options.position = { referencePanel: 'bode', direction: 'below' };
        } else if (isPanelOpen('pole-zero') && panelId === 'bode') {
            options.position = { referencePanel: 'pole-zero', direction: 'above' };
        } else if (panelId === 'nyquist') {
            // Nyquist: tab with pole-zero if open, otherwise below bode
            if (isPanelOpen('pole-zero')) {
                options.position = { referencePanel: 'pole-zero', direction: 'within' };
            } else if (isPanelOpen('bode')) {
                options.position = { referencePanel: 'bode', direction: 'below' };
            } else if (isPanelOpen('system-definition')) {
                options.position = { referencePanel: 'system-definition', direction: 'right' };
            }
        } else if (isPanelOpen('system-definition')) {
            options.position = { referencePanel: 'system-definition', direction: 'right' };
        }
    } else if (panelId === 'system-definition') {
        // System Definition: left side
        if (isPanelOpen('bode')) {
            options.position = { referencePanel: 'bode', direction: 'left' };
        }
    } else if (panelId === 'parameters' || panelId === 'frequency') {
        // Parameters/Frequency: tab together or below System Definition
        if (isPanelOpen('parameters') && panelId === 'frequency') {
            options.position = { referencePanel: 'parameters', direction: 'within' };
        } else if (isPanelOpen('frequency') && panelId === 'parameters') {
            options.position = { referencePanel: 'frequency', direction: 'within' };
        } else if (isPanelOpen('system-definition')) {
            options.position = { referencePanel: 'system-definition', direction: 'below' };
        }
    } else if (panelId === 'stability') {
        // Stability: below parameters or left of pole-zero
        if (isPanelOpen('parameters')) {
            options.position = { referencePanel: 'parameters', direction: 'below' };
        } else if (isPanelOpen('frequency')) {
            options.position = { referencePanel: 'frequency', direction: 'below' };
        } else if (isPanelOpen('pole-zero')) {
            options.position = { referencePanel: 'pole-zero', direction: 'left' };
        }
    }

    // Fallback: add as tab to first available panel
    if (!options.position) {
        for (const def of PANEL_DEFINITIONS) {
            if (isPanelOpen(def.id)) {
                options.position = { referencePanel: def.id, direction: 'within' };
                break;
            }
        }
    }

    dockviewApi.addPanel(options);

    // Re-initialize UI for the new panel
    setTimeout(() => {
        initializeUI();
        setupEventListeners();
        updateAll();
    }, 50);
}

function closePanel(panelId) {
    if (!dockviewApi) return;

    try {
        const panel = dockviewApi.getPanel(panelId);
        if (panel) {
            panel.api.close();
        }
    } catch (e) {
        console.log('Error closing panel:', e);
    }
}

window.addSlider = addSlider;
window.resetLayout = resetLayout;
window.openPanel = openPanel;
window.closePanel = closePanel;
