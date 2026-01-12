// Constants and shared state for loop shaping control design tool

// ============================================================================
// Constants
// ============================================================================
const CONSTANTS = {
    // Layout breakpoints
    NARROW_BREAKPOINT: 768,

    // Plot colors
    COLORS: {
        L: '#0088aa',      // Open-loop transfer function L(s)
        T: '#dd6600',      // Closed-loop transfer function T(s)
        S: '#22aa44',      // Sensitivity function S(s) = 1/(1+L(s))
        GRID: '#c0c0c0',
        AXIS: '#999999',
        TEXT: '#333333',
        BACKGROUND: '#ffffff',
        NYQUIST_MARKER: '#0066ff'
    },

    // Plot margins
    MARGINS: {
        LEFT: 70,
        RIGHT: 20,
        TOP: 20,
        BOTTOM: 50
    },

    // Timing
    DEBOUNCE_DELAY: 300,
    URL_UPDATE_DELAY: 1000,
    LAYOUT_SETTLE_DELAY: 50,
    RESIZE_DEBOUNCE: 100,

    // Slider range (0-1000 maps to min-max)
    SLIDER_RESOLUTION: 1000
};

// ============================================================================
// Display Options (consolidated global state)
// ============================================================================
const displayOptions = {
    // Bode plot visibility
    showL: true,
    showT: true,
    showS: false,

    // Pole-Zero Map visibility
    showLpz: true,
    showTpz: true,

    // Step Response visibility
    showLstep: false,
    showTstep: true
};

// ============================================================================
// Design State
// ============================================================================
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
    showS: false,
    autoFreq: true,
    showLpz: true,  // Pole-Zero Map: show L(s)
    showTpz: true,  // Pole-Zero Map: show T(s)
};

// Current variables from code parsing
let currentVars = {};
let updateTimeout = null;

// Auto frequency range flag
let autoFreq = true;

// ============================================================================
// Step Response Options
// ============================================================================
let stepOptions = {
    autoTime: true,        // Auto-calculate time range from dominant pole
    timeMax: 20,           // Manual time range (seconds, used when autoTime is false)
    autoTimeMultiplier: 10 // Multiplier for auto time: T = multiplier / |Re(dominant pole)|
};

// ============================================================================
// Bode Plot Options
// ============================================================================
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

// ============================================================================
// Pole-Zero Map Options
// ============================================================================
let pzmapOptions = {
    autoScale: true,            // Auto-scale based on poles/zeros
    scaleMax: 10,               // Manual scale max value (used when autoScale is false)
    autoScaleMultiplier: 1.5    // Multiplier for auto scale margin
};

// ============================================================================
// Nyquist Plot Options
// ============================================================================
let nyquistOptions = {
    showStabilityMargin: true   // Show stability margin (PM arc and GM line) on Nyquist plot
};

// ============================================================================
// Design Comparison Snapshots
// ============================================================================
// Each snapshot contains frequency response (Bode) and time response (Step) data
let savedSnapshots = [];  // Array of { name, visible, bodeData, stepData }
const MAX_SNAPSHOTS = 3;

// Cached Nyquist analysis (evaluate L(s) once, reuse for both plot and stability info)
window.lastNyquistAnalysis = null;
window.lastNyquistAnalysisKey = null;
window.lastNyquistP = null;
window.lastNyquistN = null;

// ============================================================================
// Layout State
// ============================================================================
let dockviewApi = null;
let isNarrowLayout = false;
let resizeListenerAttached = false;
let dockviewThemeObserver = null;
let plotResizeObserver = null;
let isInitialized = false;
let narrowLayoutInitialized = false;

// Dockview theme selection
const DOCKVIEW_THEME_CLASS = 'dockview-theme-light';

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

// ============================================================================
// Cached Symbolic Expressions
// ============================================================================
let cachedSymbolic = {
    Lsym: null,
    LsymRat: null,  // Rationalized Lsym for T display
    TsymSimplified: null,
    codeHash: null
};

// ============================================================================
// Event Listener Utilities
// ============================================================================

/**
 * Attach an event listener only once per element/event/key combination.
 * Uses data attributes to track attached listeners and prevent duplicates.
 * @param {HTMLElement} element - The element to attach the listener to
 * @param {string} event - The event name (e.g., 'click', 'sl-change')
 * @param {Function} handler - The event handler function
 * @param {string} [key] - Optional key to distinguish multiple listeners on same event
 * @param {Object} [options] - Optional event listener options (e.g., { passive: false })
 * @returns {boolean} - True if listener was attached, false if already attached
 */
function attachListenerOnce(element, event, handler, key = '', options = undefined) {
    if (!element) return false;

    // Convert event name to valid dataset property (replace hyphens with camelCase)
    const safeEvent = event.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const attrName = `listenerAttached${safeEvent}${key ? '_' + key : ''}`;
    if (element.dataset[attrName]) return false;

    element.addEventListener(event, handler, options);
    element.dataset[attrName] = 'true';
    return true;
}

/**
 * Get an element by ID with optional layout prefix
 * @param {string} id - The base element ID
 * @param {boolean} [useNarrowPrefix] - If true, prepend 'narrow-' to the ID
 * @returns {HTMLElement|null}
 */
function getElement(id, useNarrowPrefix = isNarrowLayout) {
    const prefix = useNarrowPrefix ? 'narrow-' : '';
    return document.getElementById(prefix + id);
}
