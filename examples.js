// Examples Dialog
// Provides typical controllers and plant transfer functions for quick reference
// Click to copy the code to clipboard

// ============================================================================
// Example Data
// ============================================================================

const EXAMPLE_CONTROLLERS = [
    {
        name: 'P Controller',
        latex: 'K(s) = K_p',
        code: 'Kp = 1\nK = Kp'
    },
    {
        name: 'PI Controller',
        latex: 'K(s) = K_p + \\frac{K_i}{s}',
        code: 'Kp = 1\nKi = 0.5\nK = Kp + Ki/s'
    },
    {
        name: 'PD Controller',
        latex: 'K(s) = K_p (1 + T_d s)',
        code: 'Kp = 1\nTd = 0.1\nK = Kp * (1 + Td*s)'
    },
    {
        name: 'PID Controller',
        latex: 'K(s) = K_p \\left(1 + \\frac{1}{T_i s} + T_d s\\right)',
        code: 'Kp = 1\nTi = 2\nTd = 0.1\nK = Kp * (1 + 1/(Ti*s) + Td*s)'
    },
    {
        name: 'Lead Compensator',
        latex: 'K(s) = k \\frac{Ts+1}{\\alpha Ts+1} \\quad (\\alpha < 1)',
        code: 'k = 2\nT = 0.1\nalpha = 0.1\nK = k * (T*s + 1) / (alpha*T*s + 1)'
    },
    {
        name: 'Lag Compensator',
        latex: 'K(s) = k \\frac{\\alpha(Ts+1)}{\\alpha Ts + 1} \\quad (\\alpha > 1)',
        code: 'k = 1\nT = 1\nalpha = 10\nK = k * alpha*(T*s + 1) / (alpha*T*s + 1)'
    }
];

const EXAMPLE_PLANTS = [
    {
        name: 'First-order System',
        latex: 'P(s) = \\frac{1}{Ts + 1}',
        code: 'T = 1\nP = 1 / (T*s + 1)'
    },
    {
        name: 'First-order + Delay',
        latex: 'P(s) = \\frac{1}{Ts + 1} e^{-L s}',
        code: 'T = 1\nLd = 0.5\nP = 1 / (T*s + 1) * exp(-Ld*s)'
    },
    {
        name: 'Second-order System',
        latex: 'P(s) = \\frac{\\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}',
        code: 'wn = 1\nzeta = 0.5\nP = wn^2 / (s^2 + 2*zeta*wn*s + wn^2)'
    },
    {
        name: 'Integrator',
        latex: 'P(s) = \\frac{1}{s}',
        code: 'P = 1 / s'
    },
    {
        name: 'Double Integrator',
        latex: 'P(s) = \\frac{1}{s^2}',
        code: 'P = 1 / s^2'
    },
    {
        name: 'Integrator + First-order',
        latex: 'P(s) = \\frac{1}{s(Ts + 1)}',
        code: 'T = 1\nP = 1 / (s * (T*s + 1))'
    },
    {
        name: 'Integrator + Delay',
        latex: 'P(s) = \\frac{1}{s} e^{-L s}',
        code: 'Ld = 0.5\nP = 1 / s * exp(-Ld*s)'
    },
    {
        name: 'Unstable First-order',
        latex: 'P(s) = \\frac{1}{Ts - 1}',
        code: 'T = 1\nP = 1 / (T*s - 1)'
    },
    {
        name: 'Non-minimum Phase',
        latex: 'P(s) = \\frac{1 - T_z s}{(T_1 s + 1)(T_2 s + 1)}',
        code: 'Tz = 0.5\nT1 = 1\nT2 = 0.2\nP = (1 - Tz*s) / ((T1*s + 1) * (T2*s + 1))'
    }
];

const EXAMPLE_FILTERS = [
    {
        name: 'Low-pass Filter',
        latex: 'F(s) = \\frac{1}{Ts + 1}',
        code: 'T = 0.1\nF = 1 / (T*s + 1)'
    },
    {
        name: 'High-pass Filter',
        latex: 'F(s) = \\frac{Ts}{Ts + 1}',
        code: 'T = 0.1\nF = T*s / (T*s + 1)'
    },
    {
        name: 'Band-pass Filter',
        latex: 'F(s) = \\frac{2\\zeta\\omega_n s}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}',
        code: 'wn = 10\nzeta = 0.5\nF = 2*zeta*wn*s / (s^2 + 2*zeta*wn*s + wn^2)'
    },
    {
        name: 'Notch Filter',
        latex: 'F(s) = \\frac{s^2 + \\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}',
        code: 'wn = 10\nzeta = 0.1\nF = (s^2 + wn^2) / (s^2 + 2*zeta*wn*s + wn^2)'
    },
    {
        name: 'Comb Filter',
        latex: 'F(s) = \\frac{1 - e^{-Ls}}{Ls}',
        code: 'Ld = 0.1\nF = (1 - exp(-Ld*s)) / (Ld*s)'
    },
    {
        name: 'Second-order Low-pass',
        latex: 'F(s) = \\frac{\\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}',
        code: 'wn = 10\nzeta = 0.707\nF = wn^2 / (s^2 + 2*zeta*wn*s + wn^2)'
    }
];

// ============================================================================
// UI Creation
// ============================================================================

function createExampleItem(example) {
    const item = document.createElement('div');
    item.className = 'example-item';

    const name = document.createElement('span');
    name.className = 'example-name';
    name.textContent = example.name;

    const formula = document.createElement('span');
    formula.className = 'example-formula';

    const copyIcon = document.createElement('sl-icon');
    copyIcon.className = 'example-copy-icon';
    copyIcon.name = 'clipboard';

    item.appendChild(name);
    item.appendChild(formula);
    item.appendChild(copyIcon);

    try {
        katex.render(example.latex, formula, {
            displayMode: false,
            throwOnError: false
        });
    } catch (e) {
        formula.textContent = example.latex;
    }

    item.addEventListener('click', async function() {
        try {
            await navigator.clipboard.writeText(example.code);

            item.classList.add('example-item-copied');
            copyIcon.name = 'check';

            setTimeout(() => {
                item.classList.remove('example-item-copied');
                copyIcon.name = 'clipboard';
            }, 1500);
        } catch (e) {
            console.error('Failed to copy:', e);
        }
    });

    return item;
}

function populateExamplesList() {
    const controllersContainer = document.getElementById('examples-controllers');
    const plantsContainer = document.getElementById('examples-plants');
    const filtersContainer = document.getElementById('examples-filters');

    if (controllersContainer) {
        controllersContainer.innerHTML = '';
        EXAMPLE_CONTROLLERS.forEach(example => {
            controllersContainer.appendChild(createExampleItem(example));
        });
    }

    if (plantsContainer) {
        plantsContainer.innerHTML = '';
        EXAMPLE_PLANTS.forEach(example => {
            plantsContainer.appendChild(createExampleItem(example));
        });
    }

    if (filtersContainer) {
        filtersContainer.innerHTML = '';
        EXAMPLE_FILTERS.forEach(example => {
            filtersContainer.appendChild(createExampleItem(example));
        });
    }
}

// ============================================================================
// Initialization
// ============================================================================

function initializeExamplesDialog() {
    const examplesButton = document.getElementById('examples-button');
    const examplesDialog = document.getElementById('examples-dialog');

    if (!examplesButton || !examplesDialog) return;

    examplesButton.addEventListener('click', function() {
        if (!examplesDialog.hasAttribute('data-populated')) {
            populateExamplesList();
            examplesDialog.setAttribute('data-populated', 'true');
        }
        examplesDialog.show();
    });
}

document.addEventListener('DOMContentLoaded', function() {
    Promise.all([
        customElements.whenDefined('sl-dialog'),
        customElements.whenDefined('sl-icon'),
        new Promise(resolve => {
            if (typeof katex !== 'undefined') {
                resolve();
            } else {
                const checkKatex = setInterval(() => {
                    if (typeof katex !== 'undefined') {
                        clearInterval(checkKatex);
                        resolve();
                    }
                }, 50);
            }
        })
    ]).then(() => {
        initializeExamplesDialog();
    });
});
