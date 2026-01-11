// Context menu functionality for all plot panels

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

/**
 * Generic context menu setup for plot wrappers.
 * Consolidates common patterns across Bode, Step, PZ Map, and Nyquist context menus.
 * @param {Object} config - Configuration object
 * @param {string} config.wrapperId - Base ID of the wrapper element (prefix will be added)
 * @param {string} config.menuId - ID of the context menu element
 * @param {string} config.anchorId - ID of the context menu anchor element
 * @param {string} config.menuInnerId - ID of the inner menu for item handlers
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

    bodeWrapper.addEventListener('contextmenu', (e) => {
        // Sync checkbox and input states before showing context menu
        if (optAutoFreq) optAutoFreq.checked = autoFreq;
        if (customFreqPanel) customFreqPanel.style.display = autoFreq ? 'none' : 'block';
        if (freqMinInput) freqMinInput.value = design.freqMin.toFixed(2);
        if (freqMaxInput) freqMaxInput.value = design.freqMax.toFixed(2);
        showContextMenuAtCursor(contextMenu, contextAnchor, e);
    });

    function handleBodeMenuItem(item) {
        switch (item.id) {
            case 'bode-opt-margin-lines':
                bodeOptions.showMarginLines = item.checked;
                break;
            case 'bode-opt-crossover-lines':
                bodeOptions.showCrossoverLines = item.checked;
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
        }
        updateBodePlot();
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

        initializeState: function() {
            const optAutoTime = document.getElementById('step-opt-auto-time');
            if (optAutoTime) optAutoTime.checked = stepOptions.autoTime;
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
            if (item.id === 'step-opt-auto-time') {
                stepOptions.autoTime = item.checked;
                if (customTimePanel) {
                    customTimePanel.style.display = item.checked ? 'none' : 'block';
                }
                if (item.checked) {
                    stepOptions.autoTimeMultiplier = 10;
                } else if (timeMaxInput) {
                    timeMaxInput.value = stepOptions.timeMax.toPrecision(3);
                }
            }
            updateStepResponsePlot();
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
            }
            updatePolePlot();
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

        initializeState: function() {
            const optStabilityMargin = document.getElementById('nyquist-opt-stability-margin');
            if (optStabilityMargin) optStabilityMargin.checked = nyquistOptions.showStabilityMargin;
        },

        onItemSelect: function(item) {
            if (item.id === 'nyquist-opt-stability-margin') {
                nyquistOptions.showStabilityMargin = item.checked;
            }
            updateNyquistPlot();
        }
    });
}
