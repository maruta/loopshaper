// Context menu functionality for all plot panels

// ============================================================================
// SVG Export Functions
// ============================================================================

// Helper function to download SVG string as a file
function downloadSvg(svgString, filename) {
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('SVG exported successfully!');
}

// Export Bode plot as SVG
function exportBodePlotAsSVG() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const wrapper = document.getElementById(prefix + 'bode-wrapper');
    if (!wrapper) return;

    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;
    if (!width || !height) return;

    // Get transfer functions from currentVars (same as updateBodePlot in main.js)
    const L = currentVars.L;
    const T = currentVars.T;
    const S = currentVars.S;
    if (!L || !L.isNode) {
        showToast('No transfer function defined', 'warning');
        return;
    }

    // Create SVG context using canvas2svg
    const svgCtx = new C2S(width, height);

    // Get current frequency range
    const w = logspace(design.freqMin, design.freqMax, design.freqPoints);

    // Build transfer functions array
    const transferFunctions = [
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

    // Get poles and zeros for frequency markers
    let poleZeroFrequencies = null;
    if (bodeOptions.showPoleZeroFrequencies && currentVars.analysis) {
        const olPZ = currentVars.analysis.openLoopPolesZeros;
        if (olPZ) {
            poleZeroFrequencies = {
                poles: olPZ.poles || [],
                zeros: olPZ.zeros || []
            };
        }
    }

    // Draw to SVG context
    drawBodeMulti(transferFunctions, w, null, null, {
        ctx: svgCtx,
        width: width,
        height: height,
        showMarginLines: bodeOptions.showMarginLines,
        showCrossoverLines: bodeOptions.showCrossoverLines,
        showPoleZeroFrequencies: bodeOptions.showPoleZeroFrequencies,
        poleZeroFrequencies: poleZeroFrequencies,
        autoScaleVertical: bodeOptions.autoScaleVertical,
        gainMin: bodeOptions.gainMin,
        gainMax: bodeOptions.gainMax,
        phaseMin: bodeOptions.phaseMin,
        phaseMax: bodeOptions.phaseMax
    });

    downloadSvg(svgCtx.getSerializedSvg(true), 'bode-plot.svg');
}

// Export Step Response as SVG
function exportStepResponseAsSVG() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const wrapper = document.getElementById(prefix + 'step-wrapper');
    if (!wrapper) return;

    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;
    if (!width || !height) return;

    // Get simulation data from currentVars.analysis
    const analysis = currentVars.analysis;
    if (!analysis) {
        showToast('No transfer function defined', 'warning');
        return;
    }

    const stepData = analysis.stepResponseData;
    if (!stepData) {
        showToast('Cannot export: non-rational transfer function', 'warning');
        return;
    }

    // Get current time range (auto or manual)
    const stepTimeMax = getStepTimeMax();

    const structure = analysis.lStructure;
    const delayL = stepData.delayL;
    const LCoeffs = stepData.LCoeffs;
    const ssL = stepData.ssL;

    // Choose simulation resolution
    let nPoints = 500;
    if (structure.type === 'rational_delay' && delayL > 0) {
        const dtTarget = delayL / 25;
        if (dtTarget > 0) {
            nPoints = Math.max(nPoints, Math.ceil(stepTimeMax / dtTarget) + 1);
        }
        nPoints = Math.min(nPoints, 20000);
    }

    let simData = null;

    try {
        if (structure.type === 'rational_delay') {
            const simL = simulateStepResponse(ssL, null, stepTimeMax, nPoints, delayL, 0);
            const simT = simulateClosedLoopStepResponseLoopDelay(ssL, delayL, stepTimeMax, nPoints);
            simData = { time: simL.time, yL: simL.yL, yT: simT.y };
        } else {
            // Build state-space for T = L/(1+L)
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
                console.log('Step SVG export: Cannot build T state-space:', e);
            }
            simData = simulateStepResponse(ssL, ssT, stepTimeMax, nPoints, 0, 0);
        }
    } catch (e) {
        showToast('Step response simulation failed', 'warning');
        console.log('Step SVG export error:', e);
        return;
    }

    if (!simData || !simData.time || simData.time.length === 0) {
        showToast('No simulation data available', 'warning');
        return;
    }

    // Get display options
    const showL = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-L-step')?.checked ?? true)
        : displayOptions.showLstep;
    const showT = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-T-step')?.checked ?? true)
        : displayOptions.showTstep;

    // Create SVG context using canvas2svg
    const svgCtx = new C2S(width, height);

    drawStepResponse(simData, null, null, {
        ctx: svgCtx,
        width: width,
        height: height,
        showL: showL,
        showT: showT,
        showMetrics: stepOptions.showMetrics
    });

    downloadSvg(svgCtx.getSerializedSvg(true), 'step-response.svg');
}

// Export Nyquist plot as SVG (without animation elements)
function exportNyquistPlotAsSVG() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const wrapper = document.getElementById(prefix + 'nyquist-wrapper');
    if (!wrapper) return;

    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;
    if (!width || !height) return;

    // Get L from currentVars
    const L = currentVars.L;
    if (!L || !L.isNode) {
        showToast('No transfer function defined', 'warning');
        return;
    }

    const analysis = currentVars.analysis;
    if (!analysis) {
        showToast('No analysis data available', 'warning');
        return;
    }

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

    // Create SVG context using canvas2svg
    const svgCtx = new C2S(width, height);

    drawNyquist(analysis.lCompiled, analysis.imagAxisPoles, {
        ctx: svgCtx,
        width: width,
        height: height,
        animate: false,
        analysis: analysis.nyquistAnalysis,
        phaseMargins: phaseMargins,
        showPhaseMarginArc: nyquistOptions.showStabilityMargin,
        gainMargins: gainMargins,
        showGainMarginLine: nyquistOptions.showStabilityMargin
    });

    downloadSvg(svgCtx.getSerializedSvg(true), 'nyquist-plot.svg');
}

// Export Pole-Zero Map as SVG (without Nyquist animation marker)
function exportPoleZeroMapAsSVG() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const wrapper = document.getElementById(prefix + 'pole-wrapper');
    if (!wrapper) return;

    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;
    if (!width || !height) return;

    // Get display options
    const showLpz = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-L-pz')?.checked ?? true)
        : displayOptions.showLpz;
    const showTpz = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-T-pz')?.checked ?? true)
        : displayOptions.showTpz;

    // Create SVG context using canvas2svg
    const svgCtx = new C2S(width, height);

    drawPoleZeroMap({
        ctx: svgCtx,
        width: width,
        height: height,
        showLpz: showLpz,
        showTpz: showTpz,
        showNyquistAnimation: false
    });

    downloadSvg(svgCtx.getSerializedSvg(true), 'pole-zero-map.svg');
}

// ============================================================================
// Context Menu State
// ============================================================================

// Tracks all registered context menus for the global click-outside handler
const registeredContextMenus = [];

// Global click-outside handler (registered once, handles all context menus)
let contextMenuClickHandlerAttached = false;

// ============================================================================
// Context Menu Helper Functions
// ============================================================================

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

// Show a context menu below a trigger element (for menu button clicks)
function showContextMenuBelowElement(contextMenu, contextAnchor, triggerElement) {
    const rect = triggerElement.getBoundingClientRect();
    contextAnchor.style.left = rect.left + 'px';
    contextAnchor.style.top = rect.bottom + 'px';
    contextMenu.strategy = 'fixed';
    contextMenu.active = true;
    requestAnimationFrame(() => {
        if (typeof contextMenu.reposition === 'function') {
            contextMenu.reposition();
        }
    });
}

// Setup menu item selection handler
function setupMenuItemHandlers(menuInnerId, onItemSelect, contextMenu) {
    const menuInner = document.getElementById(menuInnerId);
    if (!menuInner || menuInner.dataset.listenerAttached) return;

    function handleItem(item) {
        if (!item) return;
        // Note: Shoelace automatically toggles checkbox state on click,
        // so we don't need to toggle it manually here.
        onItemSelect(item);
        contextMenu.active = false;
    }

    menuInner.addEventListener('sl-select', (e) => {
        handleItem(e.detail.item);
    });

    menuInner.dataset.listenerAttached = 'true';
}

/**
 * Generic context menu setup for plot wrappers.
 * Consolidates common patterns across Bode, Step, PZ Map, and Nyquist context menus.
 * @param {Object} config - Configuration object
 * @param {string} config.wrapperId - Base ID of the wrapper element (prefix will be added)
 * @param {string} config.menuId - ID of the context menu element
 * @param {string} config.anchorId - ID of the context menu anchor element
 * @param {string} config.menuInnerId - ID of the inner menu for item handlers
 * @param {string} config.narrowMenuBtnId - ID of the narrow layout menu button (optional)
 * @param {Function} config.onWheel - Wheel event handler (optional)
 * @param {Function} config.onContextMenu - Called before showing context menu (optional, for syncing state)
 * @param {Function} config.onItemSelect - Menu item selection handler
 * @param {Function} config.initializeState - Initialize menu checkbox/input states (optional)
 * @param {Array<Object>} config.inputs - Array of input configurations for sl-change handlers (optional)
 *   Each input config: { id, onChange }
 */
function setupPlotContextMenu(config) {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const wrapper = document.getElementById(prefix + config.wrapperId);
    const contextMenu = document.getElementById(config.menuId);
    const contextAnchor = document.getElementById(config.anchorId);

    if (!wrapper || !contextMenu || !contextAnchor) return;
    if (wrapper.dataset.contextMenuAttached) return;
    wrapper.dataset.contextMenuAttached = 'true';

    // Register for global click-outside handling
    if (!registeredContextMenus.includes(contextMenu)) {
        registeredContextMenus.push(contextMenu);
    }
    setupGlobalContextMenuClickHandler();

    // Initialize state if provided
    if (config.initializeState) {
        config.initializeState();
    }

    // Setup input event listeners
    if (config.inputs) {
        config.inputs.forEach(({ id, onChange }) => {
            const input = document.getElementById(id);
            if (input && !input.dataset.listenerAttached) {
                input.addEventListener('sl-change', onChange);
                input.addEventListener('click', (e) => e.stopPropagation());
                input.dataset.listenerAttached = 'true';
            }
        });
    }

    // Mouse wheel handler
    if (config.onWheel && !wrapper.dataset.wheelListenerAttached) {
        wrapper.addEventListener('wheel', config.onWheel, { passive: false });
        wrapper.dataset.wheelListenerAttached = 'true';
    }

    // Context menu trigger
    wrapper.addEventListener('contextmenu', (e) => {
        if (config.onContextMenu) {
            config.onContextMenu();
        }
        showContextMenuAtCursor(contextMenu, contextAnchor, e);
    });

    // Menu button for narrow layout
    if (isNarrowLayout && config.narrowMenuBtnId) {
        const menuBtn = document.getElementById(config.narrowMenuBtnId);
        if (menuBtn && !menuBtn.dataset.listenerAttached) {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (config.onContextMenu) {
                    config.onContextMenu();
                }
                showContextMenuBelowElement(contextMenu, contextAnchor, menuBtn);
            });
            menuBtn.dataset.listenerAttached = 'true';
        }
    }

    // Menu item handlers
    setupMenuItemHandlers(config.menuInnerId, config.onItemSelect, contextMenu);
}

// ============================================================================
// Bode Context Menu
// ============================================================================

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
    const optPzFrequencies = document.getElementById('bode-opt-pz-frequencies');
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
    if (optPzFrequencies) optPzFrequencies.checked = bodeOptions.showPoleZeroFrequencies;
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

    // Function to sync context menu state before showing
    function syncBodeContextMenuState() {
        if (optAutoFreq) optAutoFreq.checked = autoFreq;
        if (customFreqPanel) customFreqPanel.style.display = autoFreq ? 'none' : 'block';
        if (freqMinInput) freqMinInput.value = design.freqMin.toFixed(2);
        if (freqMaxInput) freqMaxInput.value = design.freqMax.toFixed(2);
    }

    bodeWrapper.addEventListener('contextmenu', (e) => {
        syncBodeContextMenuState();
        showContextMenuAtCursor(contextMenu, contextAnchor, e);
    });

    // Menu button for narrow layout
    if (isNarrowLayout) {
        const menuBtn = document.getElementById('narrow-bode-menu-btn');
        if (menuBtn && !menuBtn.dataset.listenerAttached) {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                syncBodeContextMenuState();
                showContextMenuBelowElement(contextMenu, contextAnchor, menuBtn);
            });
            menuBtn.dataset.listenerAttached = 'true';
        }
    }

    function handleBodeMenuItem(item) {
        switch (item.id) {
            case 'bode-opt-margin-lines':
                bodeOptions.showMarginLines = item.checked;
                break;
            case 'bode-opt-crossover-lines':
                bodeOptions.showCrossoverLines = item.checked;
                break;
            case 'bode-opt-pz-frequencies':
                bodeOptions.showPoleZeroFrequencies = item.checked;
                break;
            case 'bode-opt-auto-scale':
                bodeOptions.autoScaleVertical = item.checked;
                if (customRangePanel) {
                    customRangePanel.style.display = item.checked ? 'none' : 'block';
                }
                break;
            case 'bode-opt-auto-freq':
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
                break;
            case 'bode-export-svg':
                exportBodePlotAsSVG();
                return; // Don't call updateBodePlot for export
        }
        updateBodePlot();
        updateBrowserUrl();
    }

    setupMenuItemHandlers('bode-context-menu-inner', handleBodeMenuItem, contextMenu);
}

// ============================================================================
// Step Response Context Menu
// ============================================================================

function setupStepContextMenu() {
    const customTimePanel = document.getElementById('step-custom-time-panel');
    const timeMaxInput = document.getElementById('step-time-max-input');

    setupPlotContextMenu({
        wrapperId: 'step-wrapper',
        menuId: 'step-context-menu',
        anchorId: 'step-context-menu-anchor',
        menuInnerId: 'step-context-menu-inner',
        narrowMenuBtnId: 'narrow-step-menu-btn',

        initializeState: function() {
            const optAutoTime = document.getElementById('step-opt-auto-time');
            const optShowMetrics = document.getElementById('step-opt-show-metrics');
            if (optAutoTime) optAutoTime.checked = stepOptions.autoTime;
            if (optShowMetrics) optShowMetrics.checked = stepOptions.showMetrics;
            if (customTimePanel) {
                customTimePanel.style.display = stepOptions.autoTime ? 'none' : 'block';
            }
            if (timeMaxInput) timeMaxInput.value = stepOptions.timeMax;
        },

        inputs: [
            {
                id: 'step-time-max-input',
                onChange: function() {
                    stepOptions.timeMax = parseFloat(timeMaxInput.value) || 20;
                    if (!stepOptions.autoTime) updateStepResponsePlot();
                }
            }
        ],

        onWheel: function(e) {
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
        },

        onItemSelect: function(item) {
            if (item.id === 'step-opt-show-metrics') {
                stepOptions.showMetrics = item.checked;
                updateStepResponsePlot();
                updateBrowserUrl();
            } else if (item.id === 'step-opt-auto-time') {
                stepOptions.autoTime = item.checked;
                if (customTimePanel) {
                    customTimePanel.style.display = item.checked ? 'none' : 'block';
                }
                if (item.checked) {
                    stepOptions.autoTimeMultiplier = 10;
                } else if (timeMaxInput) {
                    timeMaxInput.value = stepOptions.timeMax.toPrecision(3);
                }
                updateStepResponsePlot();
            } else if (item.id === 'step-export-svg') {
                exportStepResponseAsSVG();
                return; // Don't call updateStepResponsePlot for export
            } else {
                updateStepResponsePlot();
            }
        }
    });
}

// ============================================================================
// Pole-Zero Map Context Menu
// ============================================================================

function setupPzmapContextMenu() {
    const customScalePanel = document.getElementById('pzmap-custom-scale-panel');
    const scaleMaxInput = document.getElementById('pzmap-scale-max-input');

    setupPlotContextMenu({
        wrapperId: 'pole-wrapper',
        menuId: 'pzmap-context-menu',
        anchorId: 'pzmap-context-menu-anchor',
        menuInnerId: 'pzmap-context-menu-inner',
        narrowMenuBtnId: 'narrow-pzmap-menu-btn',

        initializeState: function() {
            const optAutoScale = document.getElementById('pzmap-opt-auto-scale');
            if (optAutoScale) optAutoScale.checked = pzmapOptions.autoScale;
            if (customScalePanel) {
                customScalePanel.style.display = pzmapOptions.autoScale ? 'none' : 'block';
            }
            if (scaleMaxInput) scaleMaxInput.value = pzmapOptions.scaleMax;
        },

        inputs: [
            {
                id: 'pzmap-scale-max-input',
                onChange: function() {
                    pzmapOptions.scaleMax = parseFloat(scaleMaxInput.value) || 10;
                    if (!pzmapOptions.autoScale) updatePolePlot();
                }
            }
        ],

        onWheel: function(e) {
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
        },

        onItemSelect: function(item) {
            if (item.id === 'pzmap-opt-auto-scale') {
                pzmapOptions.autoScale = item.checked;
                if (customScalePanel) {
                    customScalePanel.style.display = item.checked ? 'none' : 'block';
                }
                if (!item.checked && scaleMaxInput) {
                    scaleMaxInput.value = pzmapOptions.scaleMax.toPrecision(3);
                }
                updatePolePlot();
            } else if (item.id === 'pzmap-export-svg') {
                exportPoleZeroMapAsSVG();
                return; // Don't call updatePolePlot for export
            } else {
                updatePolePlot();
            }
        }
    });
}

// ============================================================================
// Nyquist Context Menu
// ============================================================================

function setupNyquistContextMenu() {
    setupPlotContextMenu({
        wrapperId: 'nyquist-wrapper',
        menuId: 'nyquist-context-menu',
        anchorId: 'nyquist-context-menu-anchor',
        menuInnerId: 'nyquist-context-menu-inner',
        narrowMenuBtnId: 'narrow-nyquist-menu-btn',

        initializeState: function() {
            const optStabilityMargin = document.getElementById('nyquist-opt-stability-margin');
            if (optStabilityMargin) optStabilityMargin.checked = nyquistOptions.showStabilityMargin;
        },

        onItemSelect: function(item) {
            if (item.id === 'nyquist-opt-stability-margin') {
                nyquistOptions.showStabilityMargin = item.checked;
                updateNyquistPlot();
            } else if (item.id === 'nyquist-export-svg') {
                exportNyquistPlotAsSVG();
                return; // Don't call updateNyquistPlot for export
            } else {
                updateNyquistPlot();
            }
        }
    });
}
