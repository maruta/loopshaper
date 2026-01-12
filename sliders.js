// Slider management for parameter controls

// ============================================================================
// Slider Value Conversion
// ============================================================================

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

// ============================================================================
// Slider Building
// ============================================================================

function rebuildSliders() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const container = document.getElementById(prefix + 'sliders-container');
    if (!container) return;

    container.innerHTML = '';

    design.sliders.forEach((slider, index) => {
        const div = createSliderElement(slider, index);
        container.appendChild(div);
        // Setup listeners after element is in the DOM
        if (div.setupListeners) {
            div.setupListeners();
        }
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
        <div class="slider-main">
            <sl-input type="text" class="slider-name" placeholder="Name" value="${slider.name || ''}" data-index="${index}" size="small"></sl-input>
            <sl-range class="slider-range" id="${prefix}range-${index}" min="0" max="1000" value="${initialPos}" data-index="${index}"></sl-range>
            <span class="slider-value" id="${prefix}value-${index}" title="Click to edit">${formatValue(initialValue)}</span>
            <sl-icon-button class="slider-settings-toggle" name="gear" label="Settings" data-index="${index}"></sl-icon-button>
        </div>
        <div class="slider-settings" data-index="${index}">
            <div class="slider-settings-row">
                <label>Min</label>
                <sl-input type="number" class="slider-min" value="${slider.min || 0.1}" step="any" data-index="${index}" size="small"></sl-input>
            </div>
            <div class="slider-settings-row">
                <label>Max</label>
                <sl-input type="number" class="slider-max" value="${slider.max || 100}" step="any" data-index="${index}" size="small"></sl-input>
            </div>
            <div class="slider-settings-row">
                <sl-checkbox class="slider-log" id="${prefix}log-${index}" ${slider.logScale ? 'checked' : ''} data-index="${index}" size="small">Log scale</sl-checkbox>
            </div>
            <sl-icon-button class="remove-slider" name="trash" label="Remove" data-index="${index}"></sl-icon-button>
        </div>
    `;

    // Setup function to attach event listeners after element is in DOM
    div.setupListeners = function() {
        const nameInput = div.querySelector('.slider-name');
        const minInput = div.querySelector('.slider-min');
        const maxInput = div.querySelector('.slider-max');
        const logCheck = div.querySelector('.slider-log');
        const rangeInput = div.querySelector('.slider-range');
        const removeBtn = div.querySelector('.remove-slider');
        const settingsToggle = div.querySelector('.slider-settings-toggle');
        const settingsPanel = div.querySelector('.slider-settings');
        const valueSpan = div.querySelector('.slider-value');

        // Set tooltip formatter to show actual parameter value
        if (rangeInput) {
            rangeInput.tooltipFormatter = (pos) => {
                const s = design.sliders[index];
                if (!s) return pos;
                const value = sliderPosToValue(pos, s.min, s.max, s.logScale);
                return formatValue(value);
            };
        }

        // Settings toggle (collapsible panel)
        if (settingsToggle && settingsPanel) {
            settingsToggle.addEventListener('click', function() {
                const isExpanded = settingsPanel.classList.toggle('expanded');
                settingsToggle.name = isExpanded ? 'gear-fill' : 'gear';
            });
        }

        // Direct value input on click
        if (valueSpan) {
            valueSpan.addEventListener('click', function(e) {
                e.stopPropagation();
                startDirectValueEdit(div, index);
            });
        }

        // Shoelace sl-input uses 'sl-input' event
        if (nameInput) {
            nameInput.addEventListener('sl-input', function() {
                design.sliders[index].name = this.value;
                updateCodeFromSliders();
                debounceUpdate();
            });
        }

        if (minInput) {
            minInput.addEventListener('sl-input', function() {
                design.sliders[index].min = parseFloat(this.value) || 0.1;
                updateSliderValue(index);
            });
        }

        if (maxInput) {
            maxInput.addEventListener('sl-input', function() {
                design.sliders[index].max = parseFloat(this.value) || 100;
                updateSliderValue(index);
            });
        }

        // Shoelace sl-checkbox uses 'sl-change' event
        if (logCheck) {
            logCheck.addEventListener('sl-change', function() {
                design.sliders[index].logScale = this.checked;
                updateSliderValue(index);
            });
        }

        // Shoelace sl-range uses 'sl-input' event
        if (rangeInput) {
            rangeInput.addEventListener('sl-input', function() {
                updateSliderValue(index);
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', function() {
                design.sliders.splice(index, 1);
                rebuildSliders();
                debounceUpdate();
            });
        }
    };

    return div;
}

// ============================================================================
// Direct Value Input
// ============================================================================

function startDirectValueEdit(sliderRow, index) {
    const valueSpan = sliderRow.querySelector('.slider-value');
    if (!valueSpan || valueSpan.style.display === 'none') return;

    const currentValue = design.sliders[index].currentValue;

    // Create inline input
    const input = document.createElement('sl-input');
    input.type = 'number';
    input.size = 'small';
    input.value = currentValue;
    input.step = 'any';
    input.className = 'slider-value-input';

    // Replace span with input
    valueSpan.style.display = 'none';
    valueSpan.parentNode.insertBefore(input, valueSpan.nextSibling);

    // Focus and select after Shoelace component is ready
    input.updateComplete.then(() => {
        const inputEl = input.shadowRoot?.querySelector('input');
        if (inputEl) {
            inputEl.focus();
            inputEl.select();
        }
    });

    // Commit value function
    function commitValue() {
        let newValue = parseFloat(input.value);
        const slider = design.sliders[index];

        // Validate and clamp to min/max
        if (isNaN(newValue)) {
            newValue = slider.currentValue;
        } else {
            newValue = Math.max(slider.min, Math.min(slider.max, newValue));
        }

        // Update slider position
        slider.currentValue = newValue;
        const pos = valueToSliderPos(newValue, slider.min, slider.max, slider.logScale);
        const rangeInput = sliderRow.querySelector('.slider-range');
        if (rangeInput) {
            rangeInput.value = pos;
        }

        // Restore span
        valueSpan.textContent = formatValue(newValue);
        valueSpan.style.display = '';
        input.remove();

        // Trigger update
        updateAll();
    }

    // Cancel edit function
    function cancelEdit() {
        valueSpan.style.display = '';
        input.remove();
    }

    input.addEventListener('sl-blur', commitValue);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitValue();
        } else if (e.key === 'Escape') {
            cancelEdit();
        }
    });
}

// ============================================================================
// Slider Updates
// ============================================================================

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

// Expose addSlider to window
window.addSlider = addSlider;
