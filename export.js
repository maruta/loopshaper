// Code export functionality for MATLAB, Python, Julia, and Scilab

// ============================================================================
// Export Language Configurations
// ============================================================================

const exportLanguages = {
    matlab: {
        name: 'MATLAB',
        generateCode: generateMatlabCode
    },
    python: {
        name: 'Python',
        generateCode: generatePythonCode
    },
    julia: {
        name: 'Julia',
        generateCode: generateJuliaCode
    },
    scilab: {
        name: 'Scilab',
        generateCode: generateScilabCode
    }
};

let currentExportLang = 'matlab';

// ============================================================================
// Syntax Conversion
// ============================================================================

// Convert math.js expression to MATLAB syntax
function convertToMatlabSyntax(expr) {
    // math.js uses ^ for power, which is the same in MATLAB for scalar
    // But we need to ensure proper MATLAB syntax
    return expr
        .replace(/\*\*/g, '^')  // In case ** is used
        .trim();
}

// Convert math.js expression to Python syntax
function convertToPythonSyntax(expr) {
    // math.js uses ^ for power, Python uses **
    return expr
        .replace(/\^/g, '**')
        .trim();
}

// ============================================================================
// MATLAB Code Generation
// ============================================================================

function generateMatlabCode() {
    const lines = [];

    lines.push('s = tf(\'s\');');
    lines.push('');

    // Add parameters with current values
    if (design.sliders && design.sliders.length > 0) {
        lines.push('% Parameters');
        design.sliders.forEach(slider => {
            const value = slider.currentValue;
            // Format number nicely
            const formattedValue = Number.isInteger(value) ? value.toString() : value.toPrecision(6).replace(/\.?0+$/, '');
            lines.push(`${slider.name} = ${formattedValue};`);
        });
        lines.push('');
    }

    // Add system definition
    lines.push('% System definition');
    const codeLines = design.code.split('\n').filter(line => line.trim());
    codeLines.forEach(line => {
        const matlabLine = convertToMatlabSyntax(line);
        // Add semicolon if not present
        const trimmed = matlabLine.trim();
        if (trimmed && !trimmed.endsWith(';') && !trimmed.startsWith('%')) {
            lines.push(trimmed + ';');
        } else {
            lines.push(trimmed);
        }
    });
    lines.push('');

    // Add closed-loop transfer function
    lines.push('% Closed-loop transfer function');
    lines.push('T = feedback(L, 1);');
    lines.push('');

    // Add analysis commands
    lines.push('% Analysis');
    lines.push('figure; margin(L);');
    lines.push('figure; nyquist(L);');
    lines.push('figure; pzmap(L, T);');
    lines.push('figure; step(T);');
    lines.push('allmargin(L)');

    return lines.join('\n');
}

// ============================================================================
// Python Code Generation
// ============================================================================

function generatePythonCode() {
    const lines = [];

    lines.push('import control as ctrl');
    lines.push('import matplotlib.pyplot as plt');
    lines.push('');

    // Add parameters with current values
    if (design.sliders && design.sliders.length > 0) {
        lines.push('# Parameters');
        design.sliders.forEach(slider => {
            const value = slider.currentValue;
            const formattedValue = Number.isInteger(value) ? value.toString() : value.toPrecision(6).replace(/\.?0+$/, '');
            lines.push(`${slider.name} = ${formattedValue}`);
        });
        lines.push('');
    }

    // Add system definition
    lines.push('# System definition');
    lines.push('s = ctrl.TransferFunction.s');
    const codeLines = design.code.split('\n').filter(line => line.trim());
    // Check if any line contains time delay pattern exp(-...*s)
    const hasDelay = codeLines.some(line => /exp\s*\(\s*-\s*[^)]+\s*\*?\s*s\s*\)/.test(line));
    if (hasDelay) {
        lines.push('# Note: python-control does not support time delays (exp(-T*s)).');
        lines.push('# You may need to use Pade approximation: num, den = ctrl.pade(T, 5)');
        lines.push('');
    }
    codeLines.forEach(line => {
        // Convert to Python syntax (^ to **)
        const pythonLine = convertToPythonSyntax(line);
        lines.push(pythonLine);
    });
    lines.push('L.name = \'L\'');
    lines.push('');

    // Add closed-loop transfer function
    lines.push('# Closed-loop transfer function');
    lines.push('T = ctrl.feedback(L, 1)');
    lines.push('T.name = \'T\'');
    lines.push('');

    // Add analysis commands
    lines.push('# Analysis');
    lines.push('plt.figure()');
    lines.push('ctrl.bode_plot(L, display_margins=True)');
    lines.push('ctrl.bode_plot(T)');
    lines.push('');
    lines.push('plt.figure()');
    lines.push('ctrl.nyquist_plot(L)');
    lines.push('');
    lines.push('plt.figure()');
    lines.push('ctrl.pzmap([L, T])');
    lines.push('');
    lines.push('plt.figure()');
    lines.push('ctrl.step_response(T).plot()');
    lines.push('print(ctrl.step_info(T))');
    lines.push('');
    lines.push('plt.show()');

    return lines.join('\n');
}

// ============================================================================
// Julia Code Generation
// ============================================================================

function generateJuliaCode() {
    const lines = [];

    lines.push('using ControlSystems');
    lines.push('using Plots');
    lines.push('');

    // Add parameters with current values
    if (design.sliders && design.sliders.length > 0) {
        lines.push('# Parameters');
        design.sliders.forEach(slider => {
            const value = slider.currentValue;
            const formattedValue = Number.isInteger(value) ? value.toString() : value.toPrecision(6).replace(/\.?0+$/, '');
            lines.push(`${slider.name} = ${formattedValue}`);
        });
        lines.push('');
    }

    // Add system definition
    lines.push('# System definition');
    lines.push('s = tf("s")');
    const codeLines = design.code.split('\n').filter(line => line.trim());
    // Check if any line contains time delay pattern exp(-...*s)
    const hasDelay = codeLines.some(line => /exp\s*\(\s*-\s*[^)]+\s*\*?\s*s\s*\)/.test(line));
    if (hasDelay) {
        lines.push('# Note: ControlSystems.jl understands exp(-T*s), but multiplying an improper');
        lines.push('# transfer function (e.g., PD controller) with a delayed system may fail.');
        lines.push('# Workaround: Define P without delay, compute L = K*P, then apply delay(T) to L.');
        lines.push('');
    }
    codeLines.forEach(line => {
        // Julia uses ^ for power (same as math.js)
        const juliaLine = line.trim();
        lines.push(juliaLine);
    });
    lines.push('');

    // Add closed-loop transfer function
    lines.push('# Closed-loop transfer function');
    lines.push('Tcl = feedback(L, 1)');
    lines.push('');

    // Add analysis commands
    lines.push('# Analysis');
    lines.push('display(marginplot(L, title="Bode Plot with Margins"))');
    lines.push('display(nyquistplot(L, title="Nyquist Plot"))');
    lines.push('display(pzmap(L, title="Pole-Zero Map"))');
    lines.push('display(plot(step(Tcl), title="Step Response"))');

    return lines.join('\n');
}

// ============================================================================
// Scilab Code Generation
// ============================================================================

function generateScilabCode() {
    const lines = [];

    lines.push('s = %s;');
    lines.push('');

    // Add parameters with current values
    if (design.sliders && design.sliders.length > 0) {
        lines.push('// Parameters');
        design.sliders.forEach(slider => {
            const value = slider.currentValue;
            const formattedValue = Number.isInteger(value) ? value.toString() : value.toPrecision(6).replace(/\.?0+$/, '');
            lines.push(`${slider.name} = ${formattedValue};`);
        });
        lines.push('');
    }

    // Add system definition
    lines.push('// System definition');
    const codeLines = design.code.split('\n').filter(line => line.trim());
    // Check if any line contains time delay pattern exp(-...*s)
    const hasDelay = codeLines.some(line => /exp\s*\(\s*-\s*[^)]+\s*\*?\s*s\s*\)/.test(line));
    if (hasDelay) {
        lines.push('// Note: Scilab does not support time delays (exp(-T*s)) in transfer functions.');
        lines.push('');
    }
    codeLines.forEach(line => {
        // Scilab uses ^ for power (same as math.js)
        const scilabLine = line.trim();
        // Add semicolon if not present
        if (scilabLine && !scilabLine.endsWith(';') && !scilabLine.startsWith('//')) {
            lines.push(scilabLine + ';');
        } else {
            lines.push(scilabLine);
        }
    });
    lines.push('L = syslin(\'c\', L);');
    lines.push('');

    // Add closed-loop transfer function
    lines.push('// Closed-loop transfer function');
    lines.push('Tcl = L /. 1;');
    lines.push('');

    // Add analysis commands
    lines.push('// Analysis');
    lines.push('scf(); show_margins(L, \'bode\');');
    lines.push('scf(); show_margins(L, \'nyquist\');');
    lines.push('scf(); plzr(L);');
    lines.push('scf(); t = 0:0.01:20; y = csim(\'step\', t, Tcl); plot(t, y);');
    lines.push('xgrid();');
    lines.push('xtitle(\'Step Response\', \'Time (s)\', \'Amplitude\');');

    return lines.join('\n');
}

// ============================================================================
// Export Dialog
// ============================================================================

function updateExportCode() {
    const codeElement = document.getElementById('export-code');
    if (!codeElement) return;

    const langConfig = exportLanguages[currentExportLang];
    if (langConfig && langConfig.generateCode) {
        codeElement.textContent = langConfig.generateCode();
    }
}

function showExportDialog() {
    const dialog = document.getElementById('export-dialog');
    if (!dialog) return;

    // Reset to default tab
    currentExportLang = 'matlab';
    const tabBtns = dialog.querySelectorAll('.export-tab-btn');
    tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === currentExportLang);
    });

    // Generate and display code
    updateExportCode();

    dialog.show();
}

function initializeExportDialog() {
    const exportButton = document.getElementById('export-button');
    const exportCopyBtn = document.getElementById('export-copy-btn');
    const dialog = document.getElementById('export-dialog');

    // Open dialog on button click
    if (exportButton) {
        exportButton.addEventListener('click', showExportDialog);
    }

    // Tab switching
    if (dialog) {
        const tabBtns = dialog.querySelectorAll('.export-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                currentExportLang = this.dataset.lang;
                tabBtns.forEach(b => b.classList.toggle('active', b === this));
                updateExportCode();
            });
        });
    }

    // Copy button
    if (exportCopyBtn) {
        exportCopyBtn.addEventListener('click', async () => {
            const code = document.getElementById('export-code')?.textContent;
            if (code) {
                try {
                    await navigator.clipboard.writeText(code);
                    showToast('Code copied to clipboard!');
                } catch (e) {
                    showToast('Failed to copy code', 'warning');
                }
            }
        });
    }
}
