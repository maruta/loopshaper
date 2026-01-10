// Main logic for loop shaping control design tool

// Default design
let design = {
    code: `K = Kp*(1 + Td*s)
P = 1/(s^2*(s + 1))
L = K * P`,
    sliders: [
        { name: 'Kp', min: 0.01, max: 10, logScale: true, currentValue: 0.1 },
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
let showL = true;
let showT = true;
let autoFreq = true;
let showLpz = true;  // Pole-Zero Map: show L(s)
let showTpz = true;  // Pole-Zero Map: show T(s)
let showLstep = false;  // Step Response: show L(s)
let showTstep = true;   // Step Response: show T(s)

// Step response display options
let stepOptions = {
    autoTime: true,        // Auto-calculate time range from dominant pole
    timeMax: 20,           // Manual time range (seconds, used when autoTime is false)
    autoTimeMultiplier: 10 // Multiplier for auto time: T = multiplier / |Re(dominant pole)|
};

// Get current step response time range (auto or manual)
function getStepTimeMax() {
    return stepOptions.autoTime ? calculateAutoStepTime() : stepOptions.timeMax;
}

// Bode plot display options
let bodeOptions = {
    showMarginLines: true,      // Show GM/PM lines
    showCrossoverLines: true,   // Show gain/phase crossover lines
    autoScaleVertical: true,    // Auto-scale vertical axis
    // Custom range values (used when autoScaleVertical is false)
    gainMin: -60,
    gainMax: 60,
    phaseMin: -270,
    phaseMax: 90
};

// Pole-Zero Map display options
let pzmapOptions = {
    autoScale: true,            // Auto-scale based on poles/zeros
    scaleMax: 10,               // Manual scale max value (used when autoScale is false)
    autoScaleMultiplier: 1.5    // Multiplier for auto scale margin
};

// Nyquist plot display options
let nyquistOptions = {
    showStabilityMargin: true   // Show stability margin (PM arc and GM line) on Nyquist plot
};

// Cached Nyquist analysis (evaluate L(s) once, reuse for both plot and stability info)
window.lastNyquistAnalysis = null;
window.lastNyquistAnalysisKey = null;
window.lastNyquistP = null;
window.lastNyquistN = null;

// Dockview API reference
let dockviewApi = null;

// Flag to prevent URL updates during initialization
let isInitialized = false;

// Panel definitions for the View menu
const PANEL_DEFINITIONS = [
    { id: 'system-definition', component: 'system-definition', title: 'System Definition' },
    { id: 'parameters', component: 'parameters', title: 'Parameters' },
    { id: 'bode', component: 'bode', title: 'Bode Plot' },
    { id: 'stability', component: 'stability', title: 'Stability' },
    { id: 'pole-zero', component: 'pole-zero', title: 'Pole-Zero Map' },
    { id: 'nyquist', component: 'nyquist', title: 'Nyquist Plot' },
    { id: 'step-response', component: 'step-response', title: 'Step Response' }
];

// Get dockview-core from global scope (UMD build uses window["dockview-core"])
const dockview = window["dockview-core"];

// Dockview theme selection
const DOCKVIEW_THEME_CLASS = 'dockview-theme-light';

// Layout state
let isNarrowLayout = false;
let resizeListenerAttached = false;
let dockviewThemeObserver = null;
let plotResizeObserver = null;

function applyDockviewTheme(el, themeClass) {
    if (!el) return;

    // remove any other theme classes to avoid CSS variable overrides
    for (const c of Array.from(el.classList)) {
        if (c.startsWith('dockview-theme-') && c !== themeClass) {
            el.classList.remove(c);
        }
    }

    if (!el.classList.contains(themeClass)) {
        el.classList.add(themeClass);
    }
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

    // Restore layout from URL if available, otherwise use default
    if (design.layout) {
        try {
            dockviewApi.fromJSON(design.layout);
        } catch (e) {
            console.log('Failed to restore layout from URL:', e);
            createDefaultLayout();
        }
    } else {
        createDefaultLayout();
    }

    // Listen for layout changes to redraw canvases and sync URL
    dockviewApi.onDidLayoutChange(() => {
        stopNyquistAnimation();
        setTimeout(() => {
            updateBodePlot();
            updatePolePlot();
            updateNyquistPlot();
            updateStepResponsePlot();
        }, 50);
        updateBrowserUrl();
    });

    // Listen for panel activation to update plots that were skipped
    dockviewApi.onDidActivePanelChange((event) => {
        stopNyquistAnimation();

        setTimeout(() => {
            initializeUI();
            setupEventListeners();

            // Render plots that were skipped during updateAll (only plot panels need this)
            if (event && event.panel) {
                const panelId = event.panel.id;
                if (panelId === 'pole-zero') {
                    updatePolePlot();
                } else if (panelId === 'nyquist') {
                    updateNyquistPlot();
                } else if (panelId === 'step-response') {
                    updateStepResponsePlot();
                }
                // Note: stability panel doesn't need special handling since all
                // calculations are always done in updateAll()
            }
        }, 50);
    });

    setupPlotResizeObserver();
}

// Setup ResizeObserver for plot wrappers to handle window maximize/restore
function setupPlotResizeObserver() {
    if (plotResizeObserver) {
        plotResizeObserver.disconnect();
    }

    const prefix = isNarrowLayout ? 'narrow-' : '';
    const wrapperIds = [
        prefix + 'bode-wrapper',
        prefix + 'pole-wrapper',
        prefix + 'nyquist-wrapper',
        prefix + 'step-wrapper'
    ];

    let resizeTimeout = null;

    plotResizeObserver = new ResizeObserver((entries) => {
        if (resizeTimeout) clearTimeout(resizeTimeout);

        resizeTimeout = setTimeout(() => {
            for (const entry of entries) {
                const id = entry.target.id;
                if (entry.contentRect.width <= 0 || entry.contentRect.height <= 0) continue;

                if (id.includes('bode')) {
                    updateBodePlot();
                } else if (id.includes('pole')) {
                    if (isNarrowLayout) {
                        if (document.getElementById('narrow-tab-pole-zero').style.display !== 'none') {
                            updateNarrowPolePlot();
                        }
                    } else {
                        updatePolePlot();
                    }
                } else if (id.includes('nyquist')) {
                    if (isNarrowLayout) {
                        if (document.getElementById('narrow-tab-nyquist').style.display !== 'none') {
                            updateNarrowNyquistPlot();
                        }
                    } else {
                        updateNyquistPlot();
                    }
                } else if (id.includes('step')) {
                    if (isNarrowLayout) {
                        if (document.getElementById('narrow-tab-step').style.display !== 'none') {
                            updateNarrowStepResponsePlot();
                        }
                    } else {
                        updateStepResponsePlot();
                    }
                }
            }
        }, 100);
    });

    wrapperIds.forEach(id => {
        const wrapper = document.getElementById(id);
        if (wrapper) plotResizeObserver.observe(wrapper);
    });
}

// Create default panel layout for wide screens
// Layout structure (3 columns):
//   Left:   System Definition / Parameters / Stability (vertical stack)
//   Center: Nyquist Plot / Pole-Zero Map (vertical stack, square aspect ratio)
//   Right:  Bode Plot + Step Response (side-by-side if wide, stacked if tall)
function createDefaultLayout() {
    // Left column: System Definition (top)
    dockviewApi.addPanel({
        id: 'system-definition',
        component: 'system-definition',
        title: 'System Definition',
    });

    // Center column: Nyquist Plot (top)
    dockviewApi.addPanel({
        id: 'nyquist',
        component: 'nyquist',
        title: 'Nyquist Plot',
        position: { referencePanel: 'system-definition', direction: 'right' },
    });

    // Right column: Bode Plot (top)
    dockviewApi.addPanel({
        id: 'bode',
        component: 'bode',
        title: 'Bode Plot',
        position: { referencePanel: 'nyquist', direction: 'right' },
    });

    // Left column: Parameters (middle)
    dockviewApi.addPanel({
        id: 'parameters',
        component: 'parameters',
        title: 'Parameters',
        position: { referencePanel: 'system-definition', direction: 'below' },
    });

    // Left column: Stability (bottom)
    dockviewApi.addPanel({
        id: 'stability',
        component: 'stability',
        title: 'Stability',
        position: { referencePanel: 'parameters', direction: 'below' },
    });

    // Center column: Pole-Zero Map (bottom)
    dockviewApi.addPanel({
        id: 'pole-zero',
        component: 'pole-zero',
        title: 'Pole-Zero Map',
        position: { referencePanel: 'nyquist', direction: 'below' },
    });

    // Right column: Step Response (initially below Bode, may be repositioned)
    dockviewApi.addPanel({
        id: 'step-response',
        component: 'step-response',
        title: 'Step Response',
        position: { referencePanel: 'bode', direction: 'below' },
    });

    // Activate Bode Plot
    const bodePanel = dockviewApi.getPanel('bode');
    if (bodePanel) {
        bodePanel.api.setActive();
    }

    // Adjust panel sizes and layout after initial rendering
    setTimeout(() => {
        try {
            const sysDefPanel = dockviewApi.getPanel('system-definition');
            if (sysDefPanel && sysDefPanel.api) {
                sysDefPanel.api.setSize({ height: 240, width: 360 });
            }

            const stabilityPanel = dockviewApi.getPanel('stability');
            if (stabilityPanel && stabilityPanel.api) {
                stabilityPanel.api.setSize({ height: 220 });
            }

            // Constrain Nyquist/Pole-Zero to square aspect ratio
            adjustPanelsToSquare(['nyquist', 'pole-zero']);

            // Arrange Bode/Step Response based on available space
            adjustBodeStepResponseLayout();
        } catch (e) {
            // Panel size adjustment may fail during layout changes
        }
    }, 100);
}

// Constrain specified panels to square aspect ratio
// Shrinks width to match height, capped at Bode panel width to ensure right column stays visible
function adjustPanelsToSquare(panelIds) {
    const bodePanel = dockviewApi.getPanel('bode');
    const maxWidth = bodePanel ? bodePanel.api.width : 0;

    panelIds.forEach(id => {
        const panel = dockviewApi.getPanel(id);
        if (panel && panel.api) {
            const { width, height } = panel.api;
            if (width > height && height > 0) {
                // Use smaller of height (for square) or Bode width (to preserve right column)
                const targetWidth = Math.min(height, maxWidth);
                panel.api.setSize({ width: targetWidth });
            }
        }
    });
}

// Arrange Bode Plot and Step Response based on aspect ratio:
// - Wide area (width > 1.5 * height): side-by-side layout
// - Otherwise: stacked vertically (default)
function adjustBodeStepResponseLayout() {
    const bodePanel = dockviewApi.getPanel('bode');
    const stepPanel = dockviewApi.getPanel('step-response');
    if (!bodePanel || !stepPanel) return;

    const bodeWidth = bodePanel.api.width;
    const bodeHeight = bodePanel.api.height;

    if (bodeWidth > 1.5*bodeHeight) {
        // Reposition Step Response to the right of Bode Plot
        dockviewApi.removePanel(stepPanel);
        dockviewApi.addPanel({
            id: 'step-response',
            component: 'step-response',
            title: 'Step Response',
            position: { referencePanel: 'bode', direction: 'right' },
        });
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadFromUrl();

    isNarrowLayout = window.innerWidth < 768;

    // Initialize Share menu (available on all layouts)
    initializeShareMenu();

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

        // Render KaTeX math in labels
        renderMathInElement(document.body, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
            ],
            throwOnError: false
        });

        // Enable and trigger browser URL synchronization
        isInitialized = true;
        updateBrowserUrl();
    });
});

let narrowLayoutInitialized = false;

// Initialize narrow layout (static HTML, no Dockview)
function initializeNarrowLayout() {
    const tabBtns = document.querySelectorAll('.narrow-tab-btn');
    function switchToTab(tabName) {
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
        document.getElementById('narrow-tab-bode').style.display = tabName === 'bode' ? 'flex' : 'none';
        document.getElementById('narrow-tab-pole-zero').style.display = tabName === 'pole-zero' ? 'flex' : 'none';
        document.getElementById('narrow-tab-nyquist').style.display = tabName === 'nyquist' ? 'flex' : 'none';
        document.getElementById('narrow-tab-step').style.display = tabName === 'step-response' ? 'flex' : 'none';

        if (tabName === 'bode') updateBodePlot();
        else if (tabName === 'pole-zero') updateNarrowPolePlot();
        else if (tabName === 'nyquist') updateNarrowNyquistPlot();
        else if (tabName === 'step-response') updateNarrowStepResponsePlot();
    }

    // Set up event listeners only once to prevent duplicates
    if (!narrowLayoutInitialized) {
        // Tab buttons
        tabBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                switchToTab(this.dataset.tab);
            });
        });

        // Pole-Zero visibility checkboxes
        const chkLpz = document.getElementById('narrow-chk-show-L-pz');
        const chkTpz = document.getElementById('narrow-chk-show-T-pz');
        if (chkLpz) chkLpz.addEventListener('sl-change', () => updateNarrowPolePlot());
        if (chkTpz) chkTpz.addEventListener('sl-change', () => updateNarrowPolePlot());

        // Step Response visibility checkboxes
        const chkLstep = document.getElementById('narrow-chk-show-L-step');
        const chkTstep = document.getElementById('narrow-chk-show-T-step');
        if (chkLstep) chkLstep.addEventListener('sl-change', () => updateNarrowStepResponsePlot());
        if (chkTstep) chkTstep.addEventListener('sl-change', () => updateNarrowStepResponsePlot());

        // Step Response auto time checkbox
        const chkAutoTime = document.getElementById('narrow-step-auto-time');
        const stepTimeControl = document.getElementById('narrow-step-time-control');
        const stepTimeInput = document.getElementById('narrow-step-time-max');
        if (chkAutoTime) {
            chkAutoTime.addEventListener('sl-change', function() {
                stepOptions.autoTime = this.checked;
                if (stepTimeControl) stepTimeControl.style.display = this.checked ? 'none' : 'flex';
                if (stepOptions.autoTime) {
                    stepOptions.autoTimeMultiplier = 10;
                } else {
                    if (stepTimeInput) stepTimeInput.value = stepOptions.timeMax.toPrecision(3);
                }
                updateNarrowStepResponsePlot();
            });
        }

        // Step Response time input
        if (stepTimeInput) {
            stepTimeInput.addEventListener('sl-change', function() {
                stepOptions.timeMax = parseFloat(this.value) || 20;
                if (!stepOptions.autoTime) {
                    updateNarrowStepResponsePlot();
                }
            });
        }

        // Mouse wheel for step response time range
        const narrowStepWrapper = document.getElementById('narrow-step-wrapper');
        if (narrowStepWrapper) {
            narrowStepWrapper.addEventListener('wheel', function(e) {
                e.preventDefault();
                const factor = 1.05;
                const increase = e.deltaY < 0;
                if (stepOptions.autoTime) {
                    stepOptions.autoTimeMultiplier *= increase ? factor : 1 / factor;
                    stepOptions.autoTimeMultiplier = Math.max(0.1, Math.min(100, stepOptions.autoTimeMultiplier));
                } else {
                    stepOptions.timeMax *= increase ? factor : 1 / factor;
                    stepOptions.timeMax = Math.max(0.1, Math.min(1000, stepOptions.timeMax));
                    const input = document.getElementById('narrow-step-time-max');
                    if (input) input.value = stepOptions.timeMax.toPrecision(3);
                }
                updateNarrowStepResponsePlot();
            }, { passive: false });
        }

        // Mouse wheel: zoom (vertical, ±0.2 decades) and pan (horizontal, ±0.1 decades)
        const narrowBodeWrapper = document.getElementById('narrow-bode-wrapper');
        if (narrowBodeWrapper) {
            narrowBodeWrapper.addEventListener('wheel', function(e) {
                e.preventDefault();

                if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                    // Horizontal scroll: pan
                    const panAmount = e.deltaX > 0 ? 0.1 : -0.1;
                    design.freqMin += panAmount;
                    design.freqMax += panAmount;
                } else {
                    // Vertical scroll: zoom centered at cursor position
                    const leftMargin = 70;
                    const wrapperWidth = narrowBodeWrapper.clientWidth;
                    const plotWidth = wrapperWidth - leftMargin - 20;

                    const rect = narrowBodeWrapper.getBoundingClientRect();
                    let p = (e.clientX - rect.left - leftMargin) / plotWidth;
                    p = Math.max(0, Math.min(1, p));

                    const currentRange = design.freqMax - design.freqMin;
                    const wCursor = design.freqMin + p * currentRange;
                    const rangeChange = e.deltaY > 0 ? 0.2 : -0.2;
                    const newRange = Math.max(0.5, Math.min(10, currentRange + rangeChange));

                    design.freqMin = wCursor - p * newRange;
                    design.freqMax = wCursor + (1 - p) * newRange;
                }

                if (autoFreq) autoFreq = false;
                updateAll();
            }, { passive: false });
        }

        narrowLayoutInitialized = true;
    }

    // Initialize UI state (always runs to sync state after layout switch)
    const chkAutoTime = document.getElementById('narrow-step-auto-time');
    const stepTimeControl = document.getElementById('narrow-step-time-control');
    const stepTimeInput = document.getElementById('narrow-step-time-max');
    if (chkAutoTime) chkAutoTime.checked = stepOptions.autoTime;
    if (stepTimeControl) stepTimeControl.style.display = stepOptions.autoTime ? 'none' : 'flex';
    if (stepTimeInput) stepTimeInput.value = stepOptions.timeMax;

    // Switch to initial tab
    switchToTab(design.preferredPlot || 'bode');

    setupPlotResizeObserver();
}

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
        });
        chkL.dataset.listenerAttached = 'true';
    }
    if (chkT && !chkT.dataset.listenerAttached) {
        chkT.addEventListener('sl-change', function() {
            showT = this.checked;
            design.showT = showT;
            updateBodePlot();
        });
        chkT.dataset.listenerAttached = 'true';
    }

    // Wide layout only elements
    if (!isNarrowLayout) {
        // Pole-Zero Map visibility checkboxes (Shoelace sl-checkbox uses 'sl-change' event)
        const chkLpz = document.getElementById('chk-show-L-pz');
        const chkTpz = document.getElementById('chk-show-T-pz');
        if (chkLpz && !chkLpz.dataset.listenerAttached) {
            chkLpz.addEventListener('sl-change', function() {
                showLpz = this.checked;
                design.showLpz = showLpz;
                updatePolePlot();
            });
            chkLpz.dataset.listenerAttached = 'true';
        }
        if (chkTpz && !chkTpz.dataset.listenerAttached) {
            chkTpz.addEventListener('sl-change', function() {
                showTpz = this.checked;
                design.showTpz = showTpz;
                updatePolePlot();
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

        // Step Response visibility checkboxes
        const chkLstep = document.getElementById('chk-show-L-step');
        const chkTstep = document.getElementById('chk-show-T-step');
        if (chkLstep && !chkLstep.dataset.listenerAttached) {
            chkLstep.addEventListener('sl-change', function() {
                showLstep = this.checked;
                updateStepResponsePlot();
            });
            chkLstep.dataset.listenerAttached = 'true';
        }
        if (chkTstep && !chkTstep.dataset.listenerAttached) {
            chkTstep.addEventListener('sl-change', function() {
                showTstep = this.checked;
                updateStepResponsePlot();
            });
            chkTstep.dataset.listenerAttached = 'true';
        }

    }

    // Handle layout mode switching on window resize
    if (!resizeListenerAttached) {
        window.addEventListener('resize', function() {
            const newIsNarrow = window.innerWidth < 768;
            if (newIsNarrow === isNarrowLayout) return;
            isNarrowLayout = newIsNarrow;

            // Initialize the appropriate layout mode
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

// Context menu helper functions
// Tracks all registered context menus for the global click-outside handler
const registeredContextMenus = [];

// Global click-outside handler (registered once, handles all context menus)
let contextMenuClickHandlerAttached = false;

function setupGlobalContextMenuClickHandler() {
    if (contextMenuClickHandlerAttached) return;
    contextMenuClickHandlerAttached = true;

    document.addEventListener('click', (e) => {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];

        for (const contextMenu of registeredContextMenus) {
            if (!contextMenu.active) continue;

            const popupPart = contextMenu.shadowRoot?.querySelector('[part~="popup"]') || null;
            const clickedInside =
                (popupPart ? path.includes(popupPart) : false) ||
                path.includes(contextMenu) ||
                contextMenu.contains(e.target);

            if (!clickedInside) {
                contextMenu.active = false;
            }
        }
    }, { capture: true });
}

// Show a context menu at the cursor position
function showContextMenuAtCursor(contextMenu, contextAnchor, e) {
    e.preventDefault();
    contextAnchor.style.left = e.clientX + 'px';
    contextAnchor.style.top = e.clientY + 'px';
    contextMenu.strategy = 'fixed';
    contextMenu.active = true;
    requestAnimationFrame(() => {
        if (typeof contextMenu.reposition === 'function') {
            contextMenu.reposition();
        }
    });
}

// Setup menu item selection handlers (both click and sl-select)
function setupMenuItemHandlers(menuInnerId, onItemSelect, contextMenu) {
    const menuInner = document.getElementById(menuInnerId);
    if (!menuInner || menuInner.dataset.listenerAttached) return;

    function handleItem(item) {
        if (!item) return;
        item.checked = !item.checked;
        onItemSelect(item);
        contextMenu.active = false;
    }

    menuInner.addEventListener('click', (e) => {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const item = path.find(n => n && n.tagName === 'SL-MENU-ITEM') || null;
        handleItem(item);
    });

    menuInner.addEventListener('sl-select', (e) => {
        handleItem(e.detail.item);
    });

    menuInner.dataset.listenerAttached = 'true';
}

function setupBodeContextMenu() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const bodeWrapper = document.getElementById(prefix + 'bode-wrapper');
    const contextMenu = document.getElementById('bode-context-menu');
    const contextAnchor = document.getElementById('bode-context-menu-anchor');

    if (!bodeWrapper || !contextMenu || !contextAnchor) return;
    if (bodeWrapper.dataset.contextMenuAttached) return;
    bodeWrapper.dataset.contextMenuAttached = 'true';

    // Register for global click-outside handling
    if (!registeredContextMenus.includes(contextMenu)) {
        registeredContextMenus.push(contextMenu);
    }
    setupGlobalContextMenuClickHandler();

    // Context menu items
    const optMarginLines = document.getElementById('bode-opt-margin-lines');
    const optCrossoverLines = document.getElementById('bode-opt-crossover-lines');
    const optAutoScale = document.getElementById('bode-opt-auto-scale');
    const optAutoFreq = document.getElementById('bode-opt-auto-freq');
    const customRangePanel = document.getElementById('bode-custom-range-panel');
    const gainMinInput = document.getElementById('bode-gain-min');
    const gainMaxInput = document.getElementById('bode-gain-max');
    const phaseMinInput = document.getElementById('bode-phase-min');
    const phaseMaxInput = document.getElementById('bode-phase-max');
    const customFreqPanel = document.getElementById('bode-custom-freq-panel');
    const freqMinInput = document.getElementById('bode-freq-min');
    const freqMaxInput = document.getElementById('bode-freq-max');

    // Initialize checkbox states
    if (optMarginLines) optMarginLines.checked = bodeOptions.showMarginLines;
    if (optCrossoverLines) optCrossoverLines.checked = bodeOptions.showCrossoverLines;
    if (optAutoScale) optAutoScale.checked = bodeOptions.autoScaleVertical;
    if (optAutoFreq) optAutoFreq.checked = autoFreq;

    // Initialize custom range inputs and panel visibility
    if (customRangePanel) {
        customRangePanel.style.display = bodeOptions.autoScaleVertical ? 'none' : 'block';
    }
    if (gainMinInput) gainMinInput.value = bodeOptions.gainMin;
    if (gainMaxInput) gainMaxInput.value = bodeOptions.gainMax;
    if (phaseMinInput) phaseMinInput.value = bodeOptions.phaseMin;
    if (phaseMaxInput) phaseMaxInput.value = bodeOptions.phaseMax;

    // Initialize custom frequency range inputs and panel visibility
    if (customFreqPanel) {
        customFreqPanel.style.display = autoFreq ? 'none' : 'block';
    }
    if (freqMinInput) freqMinInput.value = design.freqMin;
    if (freqMaxInput) freqMaxInput.value = design.freqMax;

    // Setup gain/phase range input event listeners
    [gainMinInput, gainMaxInput, phaseMinInput, phaseMaxInput].forEach(input => {
        if (input && !input.dataset.listenerAttached) {
            input.addEventListener('sl-change', () => {
                bodeOptions.gainMin = parseFloat(gainMinInput.value) || -60;
                bodeOptions.gainMax = parseFloat(gainMaxInput.value) || 60;
                bodeOptions.phaseMin = parseFloat(phaseMinInput.value) || -270;
                bodeOptions.phaseMax = parseFloat(phaseMaxInput.value) || 90;
                updateBodePlot();
            });
            input.addEventListener('click', (e) => e.stopPropagation());
            input.dataset.listenerAttached = 'true';
        }
    });

    // Setup frequency range input event listeners
    [freqMinInput, freqMaxInput].forEach(input => {
        if (input && !input.dataset.listenerAttached) {
            input.addEventListener('sl-change', () => {
                design.freqMin = parseFloat(freqMinInput.value) || -2;
                design.freqMax = parseFloat(freqMaxInput.value) || 3;
                updateAll();
            });
            input.addEventListener('click', (e) => e.stopPropagation());
            input.dataset.listenerAttached = 'true';
        }
    });

    // Mouse wheel: zoom (vertical) and pan (horizontal)
    if (!bodeWrapper.dataset.wheelListenerAttached) {
        bodeWrapper.addEventListener('wheel', function(e) {
            e.preventDefault();

            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                const panAmount = e.deltaX > 0 ? 0.1 : -0.1;
                design.freqMin += panAmount;
                design.freqMax += panAmount;
            } else {
                const leftMargin = 70;
                const wrapperWidth = bodeWrapper.clientWidth;
                const plotWidth = wrapperWidth - leftMargin - 20;

                const rect = bodeWrapper.getBoundingClientRect();
                let p = (e.clientX - rect.left - leftMargin) / plotWidth;
                p = Math.max(0, Math.min(1, p));

                const currentRange = design.freqMax - design.freqMin;
                const wCursor = design.freqMin + p * currentRange;
                const rangeChange = e.deltaY > 0 ? 0.2 : -0.2;
                const newRange = Math.max(0.5, Math.min(10, currentRange + rangeChange));

                design.freqMin = wCursor - p * newRange;
                design.freqMax = wCursor + (1 - p) * newRange;
            }

            if (autoFreq) {
                autoFreq = false;
                if (optAutoFreq) optAutoFreq.checked = false;
                if (customFreqPanel) customFreqPanel.style.display = 'block';
            }
            if (freqMinInput) freqMinInput.value = design.freqMin.toFixed(2);
            if (freqMaxInput) freqMaxInput.value = design.freqMax.toFixed(2);

            updateAll();
        }, { passive: false });
        bodeWrapper.dataset.wheelListenerAttached = 'true';
    }

    bodeWrapper.addEventListener('contextmenu', (e) => showContextMenuAtCursor(contextMenu, contextAnchor, e));

    function handleBodeMenuItem(item) {
        if (item.id === 'bode-opt-margin-lines') {
            bodeOptions.showMarginLines = item.checked;
        } else if (item.id === 'bode-opt-crossover-lines') {
            bodeOptions.showCrossoverLines = item.checked;
        } else if (item.id === 'bode-opt-auto-scale') {
            bodeOptions.autoScaleVertical = item.checked;
            if (customRangePanel) {
                customRangePanel.style.display = item.checked ? 'none' : 'block';
            }
        } else if (item.id === 'bode-opt-auto-freq') {
            autoFreq = item.checked;
            design.autoFreq = autoFreq;
            if (customFreqPanel) {
                customFreqPanel.style.display = item.checked ? 'none' : 'block';
            }
            if (autoFreq) {
                autoAdjustFrequencyRange();
            } else {
                if (freqMinInput) freqMinInput.value = design.freqMin;
                if (freqMaxInput) freqMaxInput.value = design.freqMax;
            }
        }
        updateBodePlot();
    }

    setupMenuItemHandlers('bode-context-menu-inner', handleBodeMenuItem, contextMenu);
}

// Handle auto/manual time mode toggle for step response
function handleStepAutoTimeToggle(autoMode, customTimePanel, timeMaxInput) {
    stepOptions.autoTime = autoMode;
    if (customTimePanel) {
        customTimePanel.style.display = autoMode ? 'none' : 'block';
    }
    if (autoMode) {
        stepOptions.autoTimeMultiplier = 10;
    } else {
        if (timeMaxInput) timeMaxInput.value = stepOptions.timeMax.toPrecision(3);
    }
}

function setupStepContextMenu() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const stepWrapper = document.getElementById(prefix + 'step-wrapper');
    const contextMenu = document.getElementById('step-context-menu');
    const contextAnchor = document.getElementById('step-context-menu-anchor');

    if (!stepWrapper || !contextMenu || !contextAnchor) return;
    if (stepWrapper.dataset.contextMenuAttached) return;
    stepWrapper.dataset.contextMenuAttached = 'true';

    if (!registeredContextMenus.includes(contextMenu)) {
        registeredContextMenus.push(contextMenu);
    }
    setupGlobalContextMenuClickHandler();

    const optAutoTime = document.getElementById('step-opt-auto-time');
    const customTimePanel = document.getElementById('step-custom-time-panel');
    const timeMaxInput = document.getElementById('step-time-max-input');

    if (optAutoTime) optAutoTime.checked = stepOptions.autoTime;
    if (customTimePanel) {
        customTimePanel.style.display = stepOptions.autoTime ? 'none' : 'block';
    }
    if (timeMaxInput) timeMaxInput.value = stepOptions.timeMax;

    if (timeMaxInput && !timeMaxInput.dataset.listenerAttached) {
        timeMaxInput.addEventListener('sl-change', () => {
            stepOptions.timeMax = parseFloat(timeMaxInput.value) || 20;
            if (!stepOptions.autoTime) {
                updateStepResponsePlot();
            }
        });
        timeMaxInput.addEventListener('click', (e) => e.stopPropagation());
        timeMaxInput.dataset.listenerAttached = 'true';
    }

    if (!stepWrapper.dataset.wheelListenerAttached) {
        stepWrapper.addEventListener('wheel', function(e) {
            e.preventDefault();
            const factor = 1.05;
            const increase = e.deltaY < 0;

            if (stepOptions.autoTime) {
                stepOptions.autoTimeMultiplier *= increase ? factor : 1 / factor;
                stepOptions.autoTimeMultiplier = Math.max(0.1, Math.min(100, stepOptions.autoTimeMultiplier));
            } else {
                stepOptions.timeMax *= increase ? factor : 1 / factor;
                stepOptions.timeMax = Math.max(0.1, Math.min(1000, stepOptions.timeMax));
                if (timeMaxInput) timeMaxInput.value = stepOptions.timeMax.toPrecision(3);
            }

            updateStepResponsePlot();
        }, { passive: false });
        stepWrapper.dataset.wheelListenerAttached = 'true';
    }

    stepWrapper.addEventListener('contextmenu', (e) => showContextMenuAtCursor(contextMenu, contextAnchor, e));

    setupMenuItemHandlers('step-context-menu-inner', (item) => {
        if (item.id === 'step-opt-auto-time') {
            handleStepAutoTimeToggle(item.checked, customTimePanel, timeMaxInput);
        }
        updateStepResponsePlot();
    }, contextMenu);
}

function handlePzmapAutoScaleToggle(checked, customScalePanel, scaleMaxInput) {
    pzmapOptions.autoScale = checked;
    if (customScalePanel) {
        customScalePanel.style.display = checked ? 'none' : 'block';
    }
    if (!checked && scaleMaxInput) {
        scaleMaxInput.value = pzmapOptions.scaleMax.toPrecision(3);
    }
}

function setupPzmapContextMenu() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const poleWrapper = document.getElementById(prefix + 'pole-wrapper');
    const contextMenu = document.getElementById('pzmap-context-menu');
    const contextAnchor = document.getElementById('pzmap-context-menu-anchor');

    if (!poleWrapper || !contextMenu || !contextAnchor) return;
    if (poleWrapper.dataset.contextMenuAttached) return;
    poleWrapper.dataset.contextMenuAttached = 'true';

    if (!registeredContextMenus.includes(contextMenu)) {
        registeredContextMenus.push(contextMenu);
    }
    setupGlobalContextMenuClickHandler();

    const optAutoScale = document.getElementById('pzmap-opt-auto-scale');
    const customScalePanel = document.getElementById('pzmap-custom-scale-panel');
    const scaleMaxInput = document.getElementById('pzmap-scale-max-input');

    if (optAutoScale) optAutoScale.checked = pzmapOptions.autoScale;
    if (customScalePanel) {
        customScalePanel.style.display = pzmapOptions.autoScale ? 'none' : 'block';
    }
    if (scaleMaxInput) scaleMaxInput.value = pzmapOptions.scaleMax;

    if (scaleMaxInput && !scaleMaxInput.dataset.listenerAttached) {
        scaleMaxInput.addEventListener('sl-change', () => {
            pzmapOptions.scaleMax = parseFloat(scaleMaxInput.value) || 10;
            if (!pzmapOptions.autoScale) updatePolePlot();
        });
        scaleMaxInput.addEventListener('click', (e) => e.stopPropagation());
        scaleMaxInput.dataset.listenerAttached = 'true';
    }

    if (!poleWrapper.dataset.wheelListenerAttached) {
        poleWrapper.addEventListener('wheel', function(e) {
            e.preventDefault();
            const factor = 1.05;
            const increase = e.deltaY < 0;

            if (pzmapOptions.autoScale) {
                pzmapOptions.autoScaleMultiplier *= increase ? factor : 1 / factor;
                pzmapOptions.autoScaleMultiplier = Math.max(1.0, Math.min(10, pzmapOptions.autoScaleMultiplier));
            } else {
                pzmapOptions.scaleMax *= increase ? factor : 1 / factor;
                pzmapOptions.scaleMax = Math.max(0.1, Math.min(1000, pzmapOptions.scaleMax));
                if (scaleMaxInput) scaleMaxInput.value = pzmapOptions.scaleMax.toPrecision(3);
            }
            updatePolePlot();
        }, { passive: false });
        poleWrapper.dataset.wheelListenerAttached = 'true';
    }

    poleWrapper.addEventListener('contextmenu', (e) => showContextMenuAtCursor(contextMenu, contextAnchor, e));

    setupMenuItemHandlers('pzmap-context-menu-inner', (item) => {
        if (item.id === 'pzmap-opt-auto-scale') {
            handlePzmapAutoScaleToggle(item.checked, customScalePanel, scaleMaxInput);
        }
        updatePolePlot();
    }, contextMenu);
}

function setupNyquistContextMenu() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const nyquistWrapper = document.getElementById(prefix + 'nyquist-wrapper');
    const contextMenu = document.getElementById('nyquist-context-menu');
    const contextAnchor = document.getElementById('nyquist-context-menu-anchor');

    if (!nyquistWrapper || !contextMenu || !contextAnchor) return;
    if (nyquistWrapper.dataset.contextMenuAttached) return;
    nyquistWrapper.dataset.contextMenuAttached = 'true';

    if (!registeredContextMenus.includes(contextMenu)) {
        registeredContextMenus.push(contextMenu);
    }
    setupGlobalContextMenuClickHandler();

    const optStabilityMargin = document.getElementById('nyquist-opt-stability-margin');
    if (optStabilityMargin) optStabilityMargin.checked = nyquistOptions.showStabilityMargin;

    nyquistWrapper.addEventListener('contextmenu', (e) => showContextMenuAtCursor(contextMenu, contextAnchor, e));

    setupMenuItemHandlers('nyquist-context-menu-inner', (item) => {
        if (item.id === 'nyquist-opt-stability-margin') {
            nyquistOptions.showStabilityMargin = item.checked;
        }
        if (isNarrowLayout) {
            updateNarrowNyquistPlot();
        } else {
            updateNyquistPlot();
        }
    }, contextMenu);
}

// Browser URL synchronization
// Updates address bar with shareable URL containing current design and layout
let urlUpdateTimeout = null;
const URL_UPDATE_DELAY = 1000;

function updateBrowserUrl() {
    if (!isInitialized) return;

    if (urlUpdateTimeout) {
        clearTimeout(urlUpdateTimeout);
    }
    urlUpdateTimeout = setTimeout(function() {
        try {
            const url = generateShareUrl({ includeLayout: true });
            history.replaceState(null, '', url);
        } catch (e) {
            console.log('Error updating browser URL:', e);
        }
    }, URL_UPDATE_DELAY);
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
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let div = document.createElement('div');
    div.className = 'slider-row';
    div.id = prefix + 'slider-row-' + index;

    let initialValue = slider.currentValue !== undefined ? slider.currentValue : slider.min;
    let initialPos = valueToSliderPos(initialValue, slider.min, slider.max, slider.logScale);

    div.innerHTML = `
        <div class="slider-config">
            <sl-input type="text" class="slider-name" placeholder="Name" value="${slider.name || ''}" data-index="${index}" size="small"></sl-input>
            <sl-input type="number" class="slider-min" placeholder="Min" value="${slider.min || 0.1}" step="any" data-index="${index}" size="small"></sl-input>
            <sl-input type="number" class="slider-max" placeholder="Max" value="${slider.max || 100}" step="any" data-index="${index}" size="small"></sl-input>
            <sl-checkbox class="slider-log" id="${prefix}log-${index}" ${slider.logScale ? 'checked' : ''} data-index="${index}" size="medium"></sl-checkbox>
            <sl-icon-button class="remove-slider" name="x-lg" data-index="${index}" label="Remove"></sl-icon-button>
        </div>
        <div class="slider-control">
            <sl-range class="slider-range" id="${prefix}range-${index}" min="0" max="1000" value="${initialPos}" data-index="${index}"></sl-range>
            <span class="slider-value" id="${prefix}value-${index}">${formatValue(initialValue)}</span>
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
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let slider = design.sliders[index];
    let rangeInput = document.getElementById(prefix + 'range-' + index);
    let valueSpan = document.getElementById(prefix + 'value-' + index);

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
        if (!isNarrowLayout) {
            if (isPanelVisible('pole-zero')) updatePolePlot();
            if (isPanelVisible('nyquist')) updateNyquistPlot();
            if (isPanelVisible('step-response')) updateStepResponsePlot();
        } else {
            const narrowPoleTab = document.getElementById('narrow-tab-pole-zero');
            if (narrowPoleTab && narrowPoleTab.style.display !== 'none') updateNarrowPolePlot();
            const narrowNyquistTab = document.getElementById('narrow-tab-nyquist');
            if (narrowNyquistTab && narrowNyquistTab.style.display !== 'none') updateNarrowNyquistPlot();
            const narrowStepTab = document.getElementById('narrow-tab-step');
            if (narrowStepTab && narrowStepTab.style.display !== 'none') updateNarrowStepResponsePlot();
        }
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
    const prefix = isNarrowLayout ? 'narrow-' : '';
    design.sliders.forEach((slider, index) => {
        if (!slider.name) return;
        let val = currentVars[slider.name];
        if (typeof val === 'number') {
            slider.currentValue = val;
            let rangeInput = document.getElementById(prefix + 'range-' + index);
            let valueSpan = document.getElementById(prefix + 'value-' + index);
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

    updateBrowserUrl();
}

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
        showTpz = false;
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

// Unified pole-zero map drawing function
// options: { wrapperId, canvasId, showLpz, showTpz, showNyquistAnimation }
function drawPoleZeroMap(options) {
    const canvas = document.getElementById(options.canvasId);
    const wrapper = document.getElementById(options.wrapperId);

    if (!canvas || !wrapper) return;

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

    // T(s) closed-loop poles and zeros (from stability calculation)
    const Tpoles = window.lastPoles || [];
    const Tzeros = window.lastZeros || [];

    // L(s) open-loop poles and zeros (from analysis)
    let Lpoles = [];
    let Lzeros = [];

    const analysis = currentVars.analysis;
    if (analysis) {
        const olPZ = analysis.openLoopPolesZeros;
        Lpoles = olPZ.poles;
        Lzeros = olPZ.zeros;
    }

    // Collect all points to display based on visibility settings
    const allPoints = [];
    if (options.showLpz) {
        Lpoles.forEach(p => allPoints.push(p));
        Lzeros.forEach(z => allPoints.push(z));
    }
    if (options.showTpz) {
        Tpoles.forEach(p => allPoints.push(p));
        Tzeros.forEach(z => allPoints.push(z));
    }

    if (allPoints.length === 0) return;

    // Calculate display scale (auto or manual mode)
    let maxScale;
    if (pzmapOptions.autoScale) {
        let maxRe = 0, maxIm = 0;
        allPoints.forEach(p => {
            maxRe = Math.max(maxRe, Math.abs(p.re));
            maxIm = Math.max(maxIm, Math.abs(p.im));
        });
        maxRe = Math.max(maxRe, 1) * pzmapOptions.autoScaleMultiplier;
        maxIm = Math.max(maxIm, 1) * pzmapOptions.autoScaleMultiplier;
        maxScale = Math.max(maxRe, maxIm);
    } else {
        maxScale = pzmapOptions.scaleMax;
    }

    const margin = 40;
    const plotWidth = width - 2 * margin;
    const plotHeight = height - 2 * margin;
    const scale = Math.min(plotWidth, plotHeight) / (2 * maxScale);
    const centerX = width / 2;
    const centerY = height / 2;

    // Calculate grid step size based on panel size (ensure readable spacing)
    const minPixelSpacing = 30;
    const maxGridLines = Math.floor(Math.min(plotWidth, plotHeight) / 2 / minPixelSpacing);
    const targetSteps = Math.max(2, Math.min(6, maxGridLines));
    const rawStep = maxScale / targetSteps;

    // Round to nice step values (1, 2, 5, 10, 20, 50, ...)
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    let niceStep;
    if (normalized <= 1.5) {
        niceStep = magnitude;
    } else if (normalized <= 3.5) {
        niceStep = magnitude * 2;
    } else if (normalized <= 7.5) {
        niceStep = magnitude * 5;
    } else {
        niceStep = magnitude * 10;
    }

    // Draw circular grid
    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 1;

    const maxCircleRadius = Math.ceil(maxScale / niceStep) * niceStep;
    for (let r = niceStep; r <= maxCircleRadius; r += niceStep) {
        const pixelRadius = r * scale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, pixelRadius, 0, 2 * Math.PI);
        ctx.stroke();
    }

    // Draw radial lines (every 45 degrees)
    for (let angle = 0; angle < Math.PI; angle += Math.PI / 4) {
        const dx = Math.cos(angle) * maxCircleRadius * scale;
        const dy = Math.sin(angle) * maxCircleRadius * scale;
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

    // Axis labels
    ctx.fillStyle = '#333333';
    ctx.font = '14px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Re', width - margin + 18, centerY);
    ctx.fillText('Im', centerX, margin - 15);

    // Draw tick labels on positive real axis (skip labels if too dense)
    const labelPixelSpacing = niceStep * scale;
    const minLabelSpacing = 30;
    const labelSkip = Math.max(1, Math.ceil(minLabelSpacing / labelPixelSpacing));

    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let labelIndex = 0;
    for (let r = niceStep; r <= maxCircleRadius; r += niceStep) {
        labelIndex++;
        if (labelIndex % labelSkip !== 0) continue;

        const px = centerX + r * scale;
        if (px < width - margin - 15) {
            let label;
            if (r >= 1 && r === Math.floor(r)) {
                label = r.toFixed(0);
            } else if (r >= 0.1) {
                label = r.toPrecision(2).replace(/\.?0+$/, '');
            } else {
                label = r.toPrecision(1);
            }
            ctx.fillText(label, px, centerY + 6);
        }
    }

    const colorL = '#0088aa';  // L(s) color (same as Bode plot)
    const colorT = '#dd6600';  // T(s) color (same as Bode plot)

    function isInRange(p) {
        return Math.abs(p.re) <= maxScale && Math.abs(p.im) <= maxScale;
    }

    function drawZero(z, color) {
        const px = centerX + z.re * scale;
        const py = centerY - z.im * scale;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, 2 * Math.PI);
        ctx.stroke();
    }

    function drawPole(p, color) {
        const px = centerX + p.re * scale;
        const py = centerY - p.im * scale;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - 5, py - 5);
        ctx.lineTo(px + 5, py + 5);
        ctx.moveTo(px + 5, py - 5);
        ctx.lineTo(px - 5, py + 5);
        ctx.stroke();
    }

    function drawOutOfRangeIndicator(p, isPole, color) {
        const mag = Math.sqrt(p.re * p.re + p.im * p.im);
        if (mag < 1e-10) return;

        const angle = Math.atan2(-p.im, p.re);
        const tipRadius = maxCircleRadius * scale;
        const tipX = centerX + tipRadius * Math.cos(angle);
        const tipY = centerY + tipRadius * Math.sin(angle);

        ctx.fillStyle = color;
        ctx.beginPath();
        const triDepth = 8, triWidth = 6;
        const baseRadius = tipRadius - triDepth;
        const baseX = centerX + baseRadius * Math.cos(angle);
        const baseY = centerY + baseRadius * Math.sin(angle);
        const perpAngle = angle + Math.PI / 2;
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX + triWidth * Math.cos(perpAngle), baseY + triWidth * Math.sin(perpAngle));
        ctx.lineTo(baseX - triWidth * Math.cos(perpAngle), baseY - triWidth * Math.sin(perpAngle));
        ctx.closePath();
        ctx.fill();

        const labelRadius = baseRadius - 10;
        const labelX = centerX + labelRadius * Math.cos(angle);
        const labelY = centerY + labelRadius * Math.sin(angle);

        ctx.font = '12px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let magStr;
        if (mag >= 100) {
            magStr = mag.toFixed(0);
        } else if (mag >= 10) {
            magStr = mag.toFixed(1);
        } else {
            magStr = mag.toPrecision(2);
        }

        const symbol = isPole ? '\u00d7' : '\u25cb';
        const label = symbol + magStr;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(labelX - textWidth / 2 - 2, labelY - 7, textWidth + 4, 14);
        ctx.fillStyle = color;
        ctx.fillText(label, labelX, labelY);
    }

    // Draw L(s) poles and zeros
    if (options.showLpz) {
        Lzeros.forEach(z => {
            if (isInRange(z)) {
                drawZero(z, colorL);
            } else {
                drawOutOfRangeIndicator(z, false, colorL);
            }
        });
        Lpoles.forEach(p => {
            if (isInRange(p)) {
                drawPole(p, colorL);
            } else {
                drawOutOfRangeIndicator(p, true, colorL);
            }
        });
    }

    // Draw T(s) poles and zeros
    if (options.showTpz) {
        Tzeros.forEach(z => {
            if (isInRange(z)) {
                drawZero(z, colorT);
            } else {
                drawOutOfRangeIndicator(z, false, colorT);
            }
        });
        Tpoles.forEach(p => {
            if (isInRange(p)) {
                drawPole(p, colorT);
            } else {
                drawOutOfRangeIndicator(p, true, colorT);
            }
        });
    }

    // Draw current s point from Nyquist animation (only for wide layout)
    if (options.showNyquistAnimation && options.showLpz && nyquistAnimationData && nyquistAnimationPlaying && isPanelVisible('nyquist')) {
        const currentS = getCurrentNyquistSValue();
        if (currentS) {
            if (currentS.indentation) {
                const indent = currentS.indentation;
                const polePx = centerX;
                const polePy = centerY - indent.poleIm * scale;
                const circleRadius = 12;
                ctx.strokeStyle = '#0066ff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(polePx, polePy, circleRadius, Math.PI / 2, -Math.PI / 2, true);
                ctx.stroke();
                const markerX = polePx + circleRadius * Math.cos(indent.theta);
                const markerY = polePy - circleRadius * Math.sin(indent.theta);
                ctx.fillStyle = '#0066ff';
                ctx.beginPath();
                ctx.arc(markerX, markerY, 4, 0, 2 * Math.PI);
                ctx.fill();
            } else {
                const px = centerX + currentS.re * scale;
                const py = centerY - currentS.im * scale;
                ctx.fillStyle = '#0066ff';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(px, py, 7, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
            }
        }
    }

    updateBrowserUrl();
}

// Wide layout pole-zero plot
function updatePolePlot() {
    drawPoleZeroMap({
        wrapperId: 'pole-wrapper',
        canvasId: 'pole-canvas',
        showLpz: showLpz,
        showTpz: showTpz,
        showNyquistAnimation: true
    });
}

// Narrow layout pole-zero plot
function updateNarrowPolePlot() {
    const narrowShowLpz = document.getElementById('narrow-chk-show-L-pz')?.checked ?? true;
    const narrowShowTpz = document.getElementById('narrow-chk-show-T-pz')?.checked ?? true;
    drawPoleZeroMap({
        wrapperId: 'narrow-pole-wrapper',
        canvasId: 'narrow-pole-canvas',
        showLpz: narrowShowLpz,
        showTpz: narrowShowTpz,
        showNyquistAnimation: false
    });
}

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

    updateBrowserUrl();
}

function updateNarrowNyquistPlot() {
    renderNyquistPlot('narrow-nyquist-wrapper', 'narrow-nyquist-canvas', 'narrow-nyquist-mapping-formula');
}

function updateNyquistPlot() {
    renderNyquistPlot('nyquist-wrapper', 'nyquist-canvas', 'nyquist-mapping-formula');
}

// Update stability margin display in Stability panel
function updateMargins() {
    const analysis = currentVars.analysis;
    if (!analysis) return;

    const margins = analysis.stabilityMargins;
    if (margins) {
        window.lastMargins = margins;
    }
    if (!margins) return;

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

// Calculate step response time range based on dominant closed-loop pole.
// Returns: multiplier / |Re(dominant pole)| if stable, otherwise 20 seconds.
function calculateAutoStepTime() {
    const DEFAULT_TIME = 20;

    try {
        // Check if we have closed-loop poles from stability calculation
        let clPoles = window.lastPoles || [];
        if (clPoles.length === 0) {
            return DEFAULT_TIME;
        }

        // Check if system is stable (all poles in LHP)
        let isStable = clPoles.every(p => p.re < 1e-10);
        if (!isStable) {
            return DEFAULT_TIME;
        }

        // Find the dominant pole (smallest |Re(p)| among stable poles)
        // Dominant pole determines settling time
        let dominantRe = null;
        for (let p of clPoles) {
            // Only consider poles with negative real part (stable)
            if (p.re < -1e-10) {
                let absRe = Math.abs(p.re);
                if (dominantRe === null || absRe < dominantRe) {
                    dominantRe = absRe;
                }
            }
        }

        if (dominantRe === null || dominantRe < 1e-10) {
            return DEFAULT_TIME;
        }

        // Time range = multiplier / |Re(dominant)| (adjustable via mouse wheel)
        let autoTime = stepOptions.autoTimeMultiplier / dominantRe;

        // Clamp to reasonable range
        autoTime = Math.max(0.1, Math.min(1000, autoTime));

        return autoTime;

    } catch (e) {
        console.log('Auto step time calculation error:', e);
        return DEFAULT_TIME;
    }
}

// Key mapping for URL shortening (full key -> short key)
const URL_KEY_MAP = {
    // design keys
    code: 'c',
    sliders: 's',
    freqMin: 'fm',
    freqMax: 'fx',
    freqPoints: 'fp',
    showL: 'sl',
    showT: 'st',
    autoFreq: 'af',
    showLpz: 'slp',
    showTpz: 'stp',
    preferredPlot: 'pp',
    // slider keys
    name: 'n',
    min: 'i',
    max: 'x',
    logScale: 'l',
    currentValue: 'v',
    // bodeOptions keys
    bodeOptions: 'bo',
    showMarginLines: 'ml',
    showCrossoverLines: 'cl',
    autoScaleVertical: 'av',
    gainMin: 'gi',
    gainMax: 'gx',
    phaseMin: 'pi',
    phaseMax: 'px',
    // stepOptions keys
    stepOptions: 'so',
    autoTime: 'at',
    timeMax: 'tm',
    // nyquistOptions keys
    nyquistOptions: 'no',
    showStabilityMargin: 'ssm',
    nyquistCompressionRadius: 'ncr',
    // pzmapOptions keys
    pzmapOptions: 'po',
    autoScale: 'as',
    scaleMax: 'sm',
    autoScaleMultiplier: 'asm',
    // layout
    layout: 'ly'
};

// Reverse mapping (short key -> full key)
const URL_KEY_MAP_REV = Object.fromEntries(
    Object.entries(URL_KEY_MAP).map(([k, v]) => [v, k])
);

// Default values - values matching these will be omitted from URL
const URL_DEFAULTS = {
    freqPoints: 300,
    showL: true,
    showT: true,
    autoFreq: true,
    showLpz: true,
    showTpz: true,
    // bodeOptions defaults
    bodeOptions: {
        showMarginLines: true,
        showCrossoverLines: true,
        autoScaleVertical: true,
        gainMin: -60,
        gainMax: 60,
        phaseMin: -270,
        phaseMax: 90
    },
    // stepOptions defaults
    stepOptions: {
        autoTime: true,
        timeMax: 20
    },
    // nyquistOptions defaults
    nyquistOptions: {
        showStabilityMargin: true
    },
    nyquistCompressionRadius: 3,
    // pzmapOptions defaults
    pzmapOptions: {
        autoScale: true,
        scaleMax: 10,
        autoScaleMultiplier: 1.5
    },
    // slider defaults
    sliderDefaults: {
        logScale: false
    }
};

// Shorten keys recursively for URL serialization
function shortenForUrl(obj) {
    if (Array.isArray(obj)) {
        return obj.map(item => shortenForUrl(item));
    }
    if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            const shortKey = URL_KEY_MAP[key] || key;
            result[shortKey] = shortenForUrl(value);
        }
        return result;
    }
    return obj;
}

// Expand short keys back to full keys for URL deserialization
function expandFromUrl(obj) {
    if (Array.isArray(obj)) {
        return obj.map(item => expandFromUrl(item));
    }
    if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            const fullKey = URL_KEY_MAP_REV[key] || key;
            result[fullKey] = expandFromUrl(value);
        }
        return result;
    }
    return obj;
}

// Remove default values from object to minimize URL size
function removeDefaults(obj, defaults = URL_DEFAULTS) {
    const result = { ...obj };

    for (const [key, defaultValue] of Object.entries(defaults)) {
        if (key === 'sliderDefaults') continue; // Handle separately

        if (key in result) {
            if (typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
                // Nested object (bodeOptions, stepOptions)
                if (typeof result[key] === 'object' && result[key] !== null) {
                    result[key] = removeDefaults(result[key], defaultValue);
                    // Remove if all values were defaults (empty object)
                    if (Object.keys(result[key]).length === 0) {
                        delete result[key];
                    }
                }
            } else if (result[key] === defaultValue) {
                delete result[key];
            }
        }
    }

    // Handle slider defaults
    if (result.sliders && Array.isArray(result.sliders)) {
        result.sliders = result.sliders.map(slider => {
            const s = { ...slider };
            if (s.logScale === URL_DEFAULTS.sliderDefaults.logScale) {
                delete s.logScale;
            }
            return s;
        });
    }

    return result;
}

// Apply defaults to restored object
function applyDefaults(obj, defaults = URL_DEFAULTS) {
    const result = { ...obj };

    for (const [key, defaultValue] of Object.entries(defaults)) {
        if (key === 'sliderDefaults') continue;

        if (!(key in result)) {
            if (typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
                // Don't add missing nested objects, they'll use their own defaults
            } else {
                result[key] = defaultValue;
            }
        } else if (typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
            // Merge nested objects with defaults
            result[key] = { ...defaultValue, ...result[key] };
        }
    }

    // Handle slider defaults
    if (result.sliders && Array.isArray(result.sliders)) {
        result.sliders = result.sliders.map(slider => ({
            logScale: URL_DEFAULTS.sliderDefaults.logScale,
            ...slider
        }));
    }

    return result;
}

// Generate shareable URL with design data
function generateShareUrl(options = {}) {
    const { includeLayout = false, preferredPlot = null } = options;

    saveDesign();

    // Create a copy of design for saving
    let saveData = { ...design };

    // Don't save freqMin/freqMax if autoFreq is enabled
    if (saveData.autoFreq) {
        delete saveData.freqMin;
        delete saveData.freqMax;
    }

    // Add preferred plot for narrow layout if specified
    if (preferredPlot) {
        saveData.preferredPlot = preferredPlot;
    }

    // Include Bode plot options
    saveData.bodeOptions = {
        showMarginLines: bodeOptions.showMarginLines,
        showCrossoverLines: bodeOptions.showCrossoverLines,
        autoScaleVertical: bodeOptions.autoScaleVertical,
        gainMin: bodeOptions.gainMin,
        gainMax: bodeOptions.gainMax,
        phaseMin: bodeOptions.phaseMin,
        phaseMax: bodeOptions.phaseMax
    };

    // Include Step response options
    saveData.stepOptions = {
        autoTime: stepOptions.autoTime,
        timeMax: stepOptions.timeMax
    };

    // Include Nyquist compression radius
    saveData.nyquistCompressionRadius = nyquistCompressionRadius;

    // Include Nyquist plot options
    saveData.nyquistOptions = {
        showStabilityMargin: nyquistOptions.showStabilityMargin
    };

    // Include Pole-Zero Map options
    saveData.pzmapOptions = {
        autoScale: pzmapOptions.autoScale,
        scaleMax: pzmapOptions.scaleMax,
        autoScaleMultiplier: pzmapOptions.autoScaleMultiplier
    };

    // Optionally include Dockview layout
    if (includeLayout && dockviewApi) {
        saveData.layout = dockviewApi.toJSON();
    } else {
        // Ensure layout is not included when checkbox is unchecked
        delete saveData.layout;
    }

    // Remove default values and shorten keys for compact URL
    const compactData = shortenForUrl(removeDefaults(saveData));

    let json = JSON.stringify(compactData);
    // Use pako (zlib) compression for shorter URLs
    let compressed = pako.deflate(json);
    // Convert to base64url encoding
    let base64 = btoa(String.fromCharCode.apply(null, compressed));
    let urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return location.origin + location.pathname + '#' + urlSafe;
}

// Show toast notification
async function showToast(message, variant = 'success') {
    // Create a new toast element each time (Shoelace removes toast from DOM after hiding)
    const toast = document.createElement('sl-alert');
    toast.variant = variant;
    toast.closable = true;
    toast.duration = 3000;
    toast.innerHTML = `
        <sl-icon slot="icon" name="${variant === 'success' ? 'check2-circle' : 'exclamation-triangle'}"></sl-icon>
        ${message}
    `;
    toast.style.cssText = 'position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 10000;';
    document.body.appendChild(toast);

    // Wait for autoloader to load and upgrade the element
    await customElements.whenDefined('sl-alert');
    // Wait for component to finish updating
    if (toast.updateComplete) {
        await toast.updateComplete;
    }
    toast.toast();
}

// Show QR code dialog
let currentQrUrl = '';

function generateQrSvg(url) {
    // Generate QR code
    // Use error correction level L for shorter URLs, M for longer
    const errorCorrectionLevel = url.length > 500 ? 'M' : 'L';
    const typeNumber = 0; // Auto-detect
    const qr = qrcode(typeNumber, errorCorrectionLevel);
    qr.addData(url);
    qr.make();

    // Render as SVG for crisp display
    const cellSize = 4;
    const margin = 4;
    const size = qr.getModuleCount() * cellSize + margin * 2;

    let svg = `<svg viewBox="0 0 ${size} ${size}" width="256" height="256" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="${size}" height="${size}" fill="white"/>`;

    for (let row = 0; row < qr.getModuleCount(); row++) {
        for (let col = 0; col < qr.getModuleCount(); col++) {
            if (qr.isDark(row, col)) {
                const x = col * cellSize + margin;
                const y = row * cellSize + margin;
                svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="black"/>`;
            }
        }
    }
    svg += '</svg>';

    return svg;
}

function updateQrCode() {
    const container = document.getElementById('qr-container');
    const includeLayoutCheckbox = document.getElementById('qr-include-layout');
    const preferredPlotGroup = document.getElementById('qr-preferred-plot');
    const urlSizeElement = document.getElementById('qr-url-size');

    if (!container) return;

    const includeLayout = includeLayoutCheckbox?.checked || false;
    const preferredPlot = preferredPlotGroup?.value || 'bode';

    // Generate URL with current options
    const options = {
        includeLayout,
        preferredPlot
    };

    currentQrUrl = generateShareUrl(options);
    container.innerHTML = generateQrSvg(currentQrUrl);

    // Display URL size
    if (urlSizeElement) {
        const bytes = new Blob([currentQrUrl]).size;
        urlSizeElement.textContent = `URL size: ${bytes.toLocaleString()} bytes`;
    }
}

function showShareDialog() {
    const dialog = document.getElementById('qr-dialog');
    const includeLayoutCheckbox = document.getElementById('qr-include-layout');
    const preferredPlotGroup = document.getElementById('qr-preferred-plot');

    if (!dialog) return;

    // Reset options
    if (includeLayoutCheckbox) {
        includeLayoutCheckbox.checked = false;
    }

    // Set default plot based on currently active tab in narrow mode
    if (preferredPlotGroup) {
        let defaultPlot = 'bode';
        if (isNarrowLayout) {
            const activeTab = document.querySelector('.narrow-tab-btn.active');
            if (activeTab) {
                defaultPlot = activeTab.dataset.tab;
            }
        }
        preferredPlotGroup.value = defaultPlot;
    }

    // Generate initial QR code
    updateQrCode();

    dialog.show();
}

// Initialize Share menu
function initializeShareMenu() {
    const shareButton = document.getElementById('share-button');
    const includeLayoutCheckbox = document.getElementById('qr-include-layout');
    const preferredPlotGroup = document.getElementById('qr-preferred-plot');
    const qrCopyUrl = document.getElementById('qr-copy-url');

    if (shareButton) {
        shareButton.addEventListener('click', showShareDialog);
    }

    // Update QR code when options change
    if (includeLayoutCheckbox) {
        includeLayoutCheckbox.addEventListener('sl-change', updateQrCode);
    }
    if (preferredPlotGroup) {
        preferredPlotGroup.addEventListener('sl-change', updateQrCode);
    }

    if (qrCopyUrl) {
        qrCopyUrl.addEventListener('click', async () => {
            if (currentQrUrl) {
                try {
                    await navigator.clipboard.writeText(currentQrUrl);
                    showToast('URL copied to clipboard!');
                } catch (e) {
                    showToast('Failed to copy URL', 'warning');
                }
            }
        });
    }
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

                // Expand short keys and apply defaults (new compact format)
                // Check if this is the new compact format by looking for short keys
                if ('c' in loaded || 's' in loaded) {
                    loaded = applyDefaults(expandFromUrl(loaded));
                }

                Object.assign(design, loaded);

                // Restore Bode plot options if present
                if (loaded.bodeOptions) {
                    Object.assign(bodeOptions, loaded.bodeOptions);
                }

                // Restore Step response options if present
                if (loaded.stepOptions) {
                    Object.assign(stepOptions, loaded.stepOptions);
                }

                // Restore Nyquist compression radius if present
                if (loaded.nyquistCompressionRadius !== undefined) {
                    nyquistCompressionRadius = loaded.nyquistCompressionRadius;
                }

                // Restore Nyquist plot options if present
                if (loaded.nyquistOptions) {
                    Object.assign(nyquistOptions, loaded.nyquistOptions);
                }

                // Restore Pole-Zero Map options if present
                if (loaded.pzmapOptions) {
                    Object.assign(pzmapOptions, loaded.pzmapOptions);
                }
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

// Check if a panel is currently visible (open and active in its tab group)
function isPanelVisible(panelId) {
    if (!dockviewApi) return false;
    try {
        const panel = dockviewApi.getPanel(panelId);
        return panel && panel.api.isVisible;
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
        title: panelDef.title,
    };

    // Determine best position based on panel type
    if (panelId === 'bode' || panelId === 'pole-zero' || panelId === 'nyquist' || panelId === 'step-response') {
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
        } else if (panelId === 'step-response') {
            // Step Response: tab with nyquist or pole-zero if open, otherwise below bode
            if (isPanelOpen('nyquist')) {
                options.position = { referencePanel: 'nyquist', direction: 'within' };
            } else if (isPanelOpen('pole-zero')) {
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
    } else if (panelId === 'parameters') {
        // Parameters: below System Definition
        if (isPanelOpen('system-definition')) {
            options.position = { referencePanel: 'system-definition', direction: 'below' };
        }
    } else if (panelId === 'stability') {
        // Stability: below parameters or left of pole-zero
        if (isPanelOpen('parameters')) {
            options.position = { referencePanel: 'parameters', direction: 'below' };
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

// --- Step Response Plot Functions ---

// Draw step response plot
function drawStepResponse(simData, wrapperId, canvasId, options) {
    options = options || {};
    let wrapper = document.getElementById(wrapperId);
    let canvas = document.getElementById(canvasId);

    if (!wrapper || !canvas) return;

    let ctx = canvas.getContext('2d');

    const height = wrapper.clientHeight;
    const width = wrapper.clientWidth;

    if (width === 0 || height === 0) return;

    canvas.height = height * devicePixelRatio;
    canvas.width = width * devicePixelRatio;
    canvas.style.height = height + 'px';
    canvas.style.width = width + 'px';

    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Clear canvas
    ctx.fillStyle = options.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (!simData || !simData.time || simData.time.length === 0) return;

    let showL = options.showL !== false;
    let showT = options.showT !== false;

    // Calculate data range
    let tMin = 0;
    let tMax = simData.time[simData.time.length - 1];

    let yMin = 0, yMax = 1;
    let hasData = false;

    if (showL && simData.yL) {
        let validYL = simData.yL.filter(y => isFinite(y));
        if (validYL.length > 0) {
            yMin = Math.min(yMin, Math.min(...validYL));
            yMax = Math.max(yMax, Math.max(...validYL));
            hasData = true;
        }
    }
    if (showT && simData.yT) {
        let validYT = simData.yT.filter(y => isFinite(y));
        if (validYT.length > 0) {
            yMin = Math.min(yMin, Math.min(...validYT));
            yMax = Math.max(yMax, Math.max(...validYT));
            hasData = true;
        }
    }

    if (!hasData) return;

    // Add margin to y range
    let yRange = yMax - yMin;
    if (yRange < 0.1) yRange = 0.1;
    yMin -= yRange * 0.1;
    yMax += yRange * 0.1;

    const leftMargin = 60;
    const rightMargin = 20;
    const topMargin = 20;
    const bottomMargin = 50;
    const plotWidth = width - leftMargin - rightMargin;
    const plotHeight = height - topMargin - bottomMargin;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Coordinate transformations
    let t2x = (t) => leftMargin + (t - tMin) / (tMax - tMin) * plotWidth;
    let y2y = (y) => topMargin + (yMax - y) / (yMax - yMin) * plotHeight;

    // Draw grid
    ctx.strokeStyle = '#c0c0c0';
    ctx.lineWidth = 1;
    ctx.font = '14px Consolas, monospace';
    ctx.fillStyle = '#333333';

    // Time axis grid
    let tStep = calculateNiceStep(tMax - tMin, 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= tMax; t += tStep) {
        let x = t2x(t);
        ctx.beginPath();
        ctx.moveTo(x, topMargin);
        ctx.lineTo(x, topMargin + plotHeight);
        ctx.stroke();
        ctx.fillText(formatAxisValue(t), x, topMargin + plotHeight + 8);
    }

    // Y axis grid
    let yStep = calculateNiceStep(yMax - yMin, 6);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
        let py = y2y(y);
        if (py >= topMargin && py <= topMargin + plotHeight) {
            ctx.beginPath();
            ctx.moveTo(leftMargin, py);
            ctx.lineTo(leftMargin + plotWidth, py);
            ctx.stroke();
            ctx.fillText(formatAxisValue(y), leftMargin - 8, py);
        }
    }

    // Draw y=0 line if visible
    if (yMin < 0 && yMax > 0) {
        ctx.strokeStyle = '#999999';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftMargin, y2y(0));
        ctx.lineTo(leftMargin + plotWidth, y2y(0));
        ctx.stroke();
    }

    // Draw y=1 line (steady-state reference for closed-loop)
    if (yMin < 1 && yMax > 1) {
        ctx.strokeStyle = '#999999';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(leftMargin, y2y(1));
        ctx.lineTo(leftMargin + plotWidth, y2y(1));
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw axis labels
    ctx.fillStyle = '#333333';
    ctx.font = '14px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Time [s]', leftMargin + plotWidth / 2, height - 18);

    ctx.save();
    ctx.translate(18, topMargin + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Response', 0, 0);
    ctx.restore();

    // Draw L(s) response
    if (showL && simData.yL) {
        ctx.strokeStyle = '#0088aa';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < simData.time.length; i++) {
            let x = t2x(simData.time[i]);
            let y = y2y(simData.yL[i]);
            if (isFinite(y) && y >= topMargin - 50 && y <= topMargin + plotHeight + 50) {
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
    }

    // Draw T(s) response
    if (showT && simData.yT) {
        ctx.strokeStyle = '#dd6600';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < simData.time.length; i++) {
            let x = t2x(simData.time[i]);
            let y = y2y(simData.yT[i]);
            if (isFinite(y) && y >= topMargin - 50 && y <= topMargin + plotHeight + 50) {
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
    }

    // Draw plot border
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.strokeRect(leftMargin, topMargin, plotWidth, plotHeight);
}

// Calculate nice step size for axis
function calculateNiceStep(range, targetSteps) {
    let roughStep = range / targetSteps;
    let magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    let normalized = roughStep / magnitude;

    let niceStep;
    if (normalized <= 1) niceStep = magnitude;
    else if (normalized <= 2) niceStep = 2 * magnitude;
    else if (normalized <= 5) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;

    return niceStep;
}

// Format axis value for display
function formatAxisValue(value) {
    if (Math.abs(value) < 1e-10) return '0';
    if (Math.abs(value) >= 1000 || (Math.abs(value) < 0.01 && value !== 0)) {
        return value.toExponential(1);
    }
    return parseFloat(value.toPrecision(3)).toString();
}

// Update step response plot
function updateStepResponsePlot() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    let wrapper = document.getElementById(prefix + 'step-wrapper');
    let canvas = document.getElementById(prefix + 'step-canvas');

    if (!wrapper || !canvas) return;

    // Get current time range (auto or manual)
    const stepTimeMax = getStepTimeMax();

    try {
        const analysis = currentVars.analysis;
        if (!analysis) {
            // Clear canvas
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

        // Get step response data from analysis (lazy evaluation)
        const stepData = analysis.stepResponseData;
        if (!stepData) {
            console.log('Step response: Cannot simulate non-rational transfer function');
            return;
        }

        const structure = analysis.lStructure;
        const delayL = stepData.delayL;
        const LCoeffs = stepData.LCoeffs;
        const ssL = stepData.ssL;

        // Choose simulation resolution.
        // For loop delay, we need reasonably fine dt relative to delay to avoid artifacts.
        let nPoints = 500;
        if (structure.type === 'rational_delay' && delayL > 0) {
            const dtTarget = delayL / 25;
            if (dtTarget > 0) {
                nPoints = Math.max(nPoints, Math.ceil(stepTimeMax / dtTarget) + 1);
            }
            nPoints = Math.min(nPoints, 20000);
        }

        let simData = null;
        let ssT = null;

        if (structure.type === 'rational_delay') {
            // L(s) step response itself is just a pure transport delay on the I/O behavior.
            const simL = simulateStepResponse(ssL, null, stepTimeMax, nPoints, delayL, 0);

            // T(s) must be simulated as a delayed feedback loop:
            //   T(s) = R(s)e^{-sT} / (1 + R(s)e^{-sT})
            // not (R/(1+R))e^{-sT}.
            const simT = simulateClosedLoopStepResponseLoopDelay(ssL, delayL, stepTimeMax, nPoints);

            simData = { time: simL.time, yL: simL.yL, yT: simT.y };
        } else {
            // structure.type === 'rational'
            // Build state-space for T = L/(1+L)
            // T numerator = L numerator
            // T denominator = L denominator + L numerator
            let delayT = 0;
            try {
                let Tnum = LCoeffs.num.slice();
                let Tden = [];

                // Add polynomials: ensure same length
                let maxLen = Math.max(LCoeffs.num.length, LCoeffs.den.length);
                let numPadded = LCoeffs.num.slice();
                let denPadded = LCoeffs.den.slice();
                while (numPadded.length < maxLen) numPadded.push(0);
                while (denPadded.length < maxLen) denPadded.push(0);

                for (let i = 0; i < maxLen; i++) {
                    Tden.push(numPadded[i] + denPadded[i]);
                }

                // Remove trailing zeros
                while (Tden.length > 1 && Math.abs(Tden[Tden.length - 1]) < 1e-15) {
                    Tden.pop();
                }

                ssT = tf2ss(Tnum, Tden);
            } catch (e) {
                console.log('Step response: Cannot build T state-space:', e);
            }

            simData = simulateStepResponse(ssL, ssT, stepTimeMax, nPoints, 0, delayT);
        }


        // Draw
        drawStepResponse(simData, prefix + 'step-wrapper', prefix + 'step-canvas', {
            showL: showLstep,
            showT: showTstep
        });

    } catch (e) {
        console.log('Step response plot error:', e);
    }

    updateBrowserUrl();
}

// Narrow layout step response plot
function updateNarrowStepResponsePlot() {
    let wrapper = document.getElementById('narrow-step-wrapper');
    let canvas = document.getElementById('narrow-step-canvas');

    if (!wrapper || !canvas) return;

    // Get visibility settings from narrow layout checkboxes
    let narrowShowLstep = document.getElementById('narrow-chk-show-L-step')?.checked ?? true;
    let narrowShowTstep = document.getElementById('narrow-chk-show-T-step')?.checked ?? true;

    // Temporarily override global settings
    let origShowLstep = showLstep;
    let origShowTstep = showTstep;
    showLstep = narrowShowLstep;
    showTstep = narrowShowTstep;

    // Save narrow layout state and temporarily set to call the right element IDs
    let origNarrow = isNarrowLayout;
    isNarrowLayout = true;

    updateStepResponsePlot();

    // Restore
    isNarrowLayout = origNarrow;
    showLstep = origShowLstep;
    showTstep = origShowTstep;
}
