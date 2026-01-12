// URL state management, sharing, and QR code generation

// ============================================================================
// URL Key Mapping
// ============================================================================

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
    showS: 'ss',
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
    showMetrics: 'sme',
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
    showS: false,
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
        timeMax: 20,
        showMetrics: false
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

// ============================================================================
// URL Shortening Functions
// ============================================================================

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

// ============================================================================
// URL Generation and Loading
// ============================================================================

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
        timeMax: stepOptions.timeMax,
        showMetrics: stepOptions.showMetrics
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

// ============================================================================
// Browser URL Synchronization
// ============================================================================

let urlUpdateTimeout = null;

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
            console.error('Error updating browser URL:', e);
        }
    }, CONSTANTS.URL_UPDATE_DELAY);
}

// ============================================================================
// Toast Notifications
// ============================================================================

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

// ============================================================================
// QR Code Generation
// ============================================================================

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

// ============================================================================
// Share Menu Initialization
// ============================================================================

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
