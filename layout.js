// Layout management: Dockview, panels, resize observers

// ============================================================================
// Dockview Theme Management
// ============================================================================

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

// ============================================================================
// Panel Renderer Class
// ============================================================================

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

// ============================================================================
// Dockview Initialization
// ============================================================================

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

// ============================================================================
// Resize Observer
// ============================================================================

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
                    updatePolePlot();
                } else if (id.includes('nyquist')) {
                    updateNyquistPlot();
                } else if (id.includes('step')) {
                    updateStepResponsePlot();
                }
            }
        }, 100);
    });

    wrapperIds.forEach(id => {
        const wrapper = document.getElementById(id);
        if (wrapper) plotResizeObserver.observe(wrapper);
    });
}

// ============================================================================
// Default Layout
// ============================================================================

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

// ============================================================================
// Narrow Layout
// ============================================================================

function initializeNarrowLayout() {
    const tabBtns = document.querySelectorAll('.narrow-tab-btn');
    function switchToTab(tabName) {
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
        document.getElementById('narrow-tab-bode').style.display = tabName === 'bode' ? 'flex' : 'none';
        document.getElementById('narrow-tab-pole-zero').style.display = tabName === 'pole-zero' ? 'flex' : 'none';
        document.getElementById('narrow-tab-nyquist').style.display = tabName === 'nyquist' ? 'flex' : 'none';
        document.getElementById('narrow-tab-step').style.display = tabName === 'step-response' ? 'flex' : 'none';

        if (tabName === 'bode') updateBodePlot();
        else if (tabName === 'pole-zero') updatePolePlot();
        else if (tabName === 'nyquist') updateNyquistPlot();
        else if (tabName === 'step-response') updateStepResponsePlot();
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
        if (chkLpz) chkLpz.addEventListener('sl-change', () => updatePolePlot());
        if (chkTpz) chkTpz.addEventListener('sl-change', () => updatePolePlot());

        // Step Response visibility checkboxes
        const chkLstep = document.getElementById('narrow-chk-show-L-step');
        const chkTstep = document.getElementById('narrow-chk-show-T-step');
        if (chkLstep) chkLstep.addEventListener('sl-change', () => updateStepResponsePlot());
        if (chkTstep) chkTstep.addEventListener('sl-change', () => updateStepResponsePlot());

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
                updateStepResponsePlot();
            });
        }

        // Step Response time input
        if (stepTimeInput) {
            stepTimeInput.addEventListener('sl-change', function() {
                stepOptions.timeMax = parseFloat(this.value) || 20;
                if (!stepOptions.autoTime) {
                    updateStepResponsePlot();
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
                updateStepResponsePlot();
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

// ============================================================================
// View Menu Functions
// ============================================================================

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

// Check if a plot is visible in either wide (Dockview) or narrow (tab) layout
function isPlotVisible(plotId) {
    if (!isNarrowLayout) {
        return isPanelVisible(plotId);
    }
    // Narrow layout: check if the corresponding tab is visible
    const tabIdMap = {
        'pole-zero': 'narrow-tab-pole-zero',
        'nyquist': 'narrow-tab-nyquist',
        'step-response': 'narrow-tab-step'
    };
    const tabId = tabIdMap[plotId];
    if (!tabId) return false;
    const tab = document.getElementById(tabId);
    return tab && tab.style.display !== 'none';
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

// Reset layout to default
function resetLayout() {
    if (dockviewApi) {
        dockviewApi.clear();
        createDefaultLayout();
    }
}

// Expose functions to window for global access
window.resetLayout = resetLayout;
window.openPanel = openPanel;
window.closePanel = closePanel;
